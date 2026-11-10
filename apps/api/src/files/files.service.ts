import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import { FileVisibility } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { ConfigService } from '../common/config/config.service';
import { PrismaService } from '../common/prisma/prisma.service';

/** 上传白名单（PRD §11.2）；禁止可执行/脚本 */
const ALLOWED_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'ppt', 'pptx', 'txt', 'md', 'csv', 'zip', 'rar', 'mp4',
]);
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'sh', 'js', 'html', 'htm']);

export interface SaveFileInput {
  buffer: Buffer;
  originalname: string;
  mimeType: string;
  uploaderId: bigint;
  visibility: FileVisibility;
  refType?: string;
  refId?: bigint;
}

/** 统一文件服务（PRD §9.2 files / §11.2）：存 Web 根之外，DB 只存元数据，下载走鉴权接口 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get uploadDir(): string {
    return process.env.UPLOAD_DIR ?? '/data/uploads';
  }

  async save(input: SaveFileInput) {
    const maxMb = await this.config.getInt('UPLOAD_MAX_MB', 20);
    const maxBytes = maxMb * 1024 * 1024;
    if (input.buffer.length > maxBytes) {
      throw ApiError.of('FILE_NOT_ACCEPTABLE', `单文件不能超过 ${maxMb}MB`);
    }
    const ext = input.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (BLOCKED_EXT.has(ext) || !ALLOWED_EXT.has(ext)) {
      throw ApiError.of('FILE_NOT_ACCEPTABLE', `不支持的文件类型 .${ext}`);
    }

    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const storageKey = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${sha256}-${Date.now()}.${ext}`;
    const fullPath = resolve(join(this.uploadDir, storageKey));
    if (!fullPath.startsWith(resolve(this.uploadDir))) {
      throw ApiError.of('FILE_NOT_ACCEPTABLE', '非法存储路径');
    }
    await mkdir(dirname(fullPath), { recursive: true });
    await pipeline(
      (function* () {
        yield input.buffer;
      })() as never,
      createWriteStream(fullPath),
    );

    const file = await this.prisma.file.create({
      data: {
        storageKey,
        originalName: input.originalname.slice(0, 255),
        mime: input.mimeType.slice(0, 128) || 'application/octet-stream',
        sizeBytes: BigInt(input.buffer.length),
        sha256,
        uploaderId: input.uploaderId,
        visibility: input.visibility,
        refType: input.refType,
        refId: input.refId,
        scanStatus: 'CLEAN', // MVP 仅 MIME/扩展名校验（§18.4-6）
      },
    });
    return file;
  }

  /** 按 visibility 鉴权后返回文件（PRD §10.3 GET /files/:id） */
  async open(fileId: bigint, viewer: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' }) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '文件不存在');
    const allowed = await this.canView(file, viewer);
    if (!allowed) throw ApiError.of('FORBIDDEN', '没有权限查看该文件');
    const fullPath = resolve(join(this.uploadDir, file.storageKey));
    if (!existsSync(fullPath)) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '文件已丢失');
    const content = await readFile(fullPath);
    return { file, content };
  }

  private async canView(
    file: { visibility: FileVisibility; uploaderId: bigint; refType: string | null; refId: bigint | null },
    viewer: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' },
  ): Promise<boolean> {
    if (viewer.role === 'ADMIN') return true;
    if (file.uploaderId === viewer.id) return true;
    switch (file.visibility) {
      case 'ADMIN_ONLY':
        return false;
      case 'TASK_PUBLIC': {
        // 登录用户可见（任务参考附件）
        return true;
      }
      case 'TASK_PARTICIPANT': {
        if (!file.refId) return false;
        const mine = await this.prisma.taskAssignment.findFirst({
          where: { taskId: file.refId, studentId: viewer.id, status: { in: ['CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SETTLED'] } },
        });
        return Boolean(mine);
      }
      case 'SUBMISSION_OWNER': {
        // 交付物：本人 / 归属教师 / 管理员
        if (viewer.role !== 'TEACHER' || !file.refId) return false;
        const submission = await this.prisma.submission.findUnique({ where: { id: file.refId }, select: { assignment: { select: { task: { select: { teacherId: true } } } } } });
        return submission?.assignment.task.teacherId === viewer.id;
      }
      case 'DISPUTE_PARTY':
        return false; // 仲裁证据仅管理员与当事双方；MVP 由管理员处理
      default:
        return false;
    }
  }

  /** 提交附件数量上限 */
  async assertFileCount(count: number): Promise<void> {
    const maxFiles = await this.config.getInt('UPLOAD_MAX_FILES', 5);
    if (count > maxFiles) throw ApiError.of('FILE_NOT_ACCEPTABLE', `单次最多上传 ${maxFiles} 个文件`);
  }

  async removeLocal(storageKey: string): Promise<void> {
    try {
      await unlink(join(this.uploadDir, storageKey));
    } catch (error) {
      this.logger.warn(`remove local file failed: ${String(error)}`);
    }
  }
}
