import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '请输入学号 / 工号' })
  @MaxLength(32)
  username!: string;

  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '请输入旧密码' })
  oldPassword!: string;

  @IsString()
  @IsNotEmpty({ message: '请输入新密码' })
  @MinLength(8, { message: '新密码至少 8 位，且需同时包含字母和数字' })
  newPassword!: string;
}
