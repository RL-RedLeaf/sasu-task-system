import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(50) title!: string;
  @IsInt() @Min(1) categoryId!: number;
  @IsString() @IsNotEmpty() @MinLength(10) @MaxLength(2000) description!: string;
  @IsOptional() @IsString() @MaxLength(500) requirement?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsString() @MaxLength(200) contactInfo?: string;
  @IsInt() @Min(1) @Max(50) headcount!: number;
  @IsISO8601() deadlineAt!: string;
  @IsOptional() @IsArray() @MaxLength(3) attachmentFileIds?: number[];
  /** 管理员代发时必须指定真实教师（PRD §6.2） */
  @IsOptional() @IsInt() @Min(1) teacherId?: number;
  /** 学生端严禁出现赏金字段；传入即忽略（验收脚本 §15.3） */
  @IsOptional() @IsIn(['IGNORED']) rewardPerPerson?: 'IGNORED';
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(50) title?: string;
  @IsOptional() @IsInt() @Min(1) categoryId?: number;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) requirement?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsString() @MaxLength(200) contactInfo?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) headcount?: number;
  @IsOptional() @IsISO8601() deadlineAt?: string;
  @IsOptional() @IsInt() @Min(0) version!: number; // If-Match 乐观锁
}

export class PriceDto {
  @IsInt() @Min(1) rewardPerPerson!: number;
}

export class RepriceDto {
  @IsInt() @Min(1) rewardPerPerson!: number;
  @IsString() @IsNotEmpty({ message: '改价必须填写原因' }) @MaxLength(255) reason!: string;
}

export class CloseTaskDto {
  @IsString() @IsNotEmpty({ message: '关闭任务必须填写原因' }) @MaxLength(255) reason!: string;
}

export class CancelTaskDto {
  @IsString() @IsNotEmpty({ message: '取消任务必须填写原因' }) @MaxLength(255) reason!: string;
}

export const EDITABLE_CONTENT_FIELDS = [
  'title',
  'categoryId',
  'description',
  'requirement',
  'location',
  'contactInfo',
  'deadlineAt',
] as const;
