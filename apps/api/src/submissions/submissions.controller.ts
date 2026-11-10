import { Body, Controller, Get, HttpCode, Param, Post, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SubmissionsService } from './submissions.service';
import { FilesService } from '../files/files.service';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { ApiError } from '../common/errors/api.error';

export class ReviewDto {
  @IsIn(['ACCEPT', 'REJECT']) decision!: 'ACCEPT' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsOptional() @IsIn([true]) isProxy?: true;
}

export class SubmitDto {
  @IsString() @MinLength(10, { message: '文字说明需 10-1000 字' }) @MaxLength(1000) content!: string;
}

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Controller()
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly files: FilesService,
  ) {}

  @HttpCode(200)
  @Post('assignments/:id/submissions')
  @UseInterceptors(FilesInterceptor('files', 5))
  async submit(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SubmitDto,
    @UploadedFiles() files: UploadedFileLike[] | undefined,
    @Req() req: Request & { requestId?: string },
  ) {
    if (user.role !== 'STUDENT') throw ApiError.of('FORBIDDEN', '只有学生可以提交交付物');
    return this.submissions.submit(
      user.id,
      BigInt(id),
      {
        content: dto.content,
        files: (files ?? []).map((f) => ({
          buffer: f.buffer,
          originalname: f.originalname,
          mimeType: f.mimetype,
        })),
      },
      { requestId: req.requestId },
    );
  }

  @Get('assignments/:id/submissions')
  async history(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.submissions.history(user.id, BigInt(id));
  }

  /** 统一验收端点：代验收走同一端点 + isProxy（PRD §10.3） */
  @HttpCode(200)
  @Post('assignments/:id/review')
  async review(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.submissions.review(
      { id: user.id, role: user.role },
      BigInt(id),
      { decision: dto.decision, reason: dto.reason, isProxy: dto.isProxy === true },
      { requestId: req.requestId },
    );
  }

  @Get('files/:id')
  async download(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const { file, content } = await this.files.open(BigInt(id), { id: user.id, role: user.role });
    return {
      meta: {
        id: file.id.toString(),
        originalName: file.originalName,
        mime: file.mime,
        sizeBytes: file.sizeBytes.toString(),
      },
      // base64 直出：MVP 单机校内部署，量级小（PRD §11.1）；大文件走流式可后续优化
      contentBase64: content.toString('base64'),
    };
  }
}
