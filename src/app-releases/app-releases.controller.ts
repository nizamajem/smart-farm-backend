import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AppRelease } from './app-release.entity';
import { AppReleasesService, MAX_APK_BYTES, releasesDir, UploadReleaseBody } from './app-releases.service';

const publicInfo = (r: AppRelease) => ({
  id: r.id,
  version: r.version,
  notes: r.notes,
  size: r.size,
  sha256: r.sha256,
  createdAt: r.createdAt,
});

@Controller('app-releases')
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  // ---------- publik (halaman login) ----------

  @Get('latest')
  async latest() {
    const r = await this.releases.latest();
    return { release: r ? publicInfo(r) : null };
  }

  @Get('latest/download')
  async downloadLatest(@Res() res: Response) {
    const { path, downloadName } = await this.releases.fileFor('latest');
    res.download(path, downloadName);
  }

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { path, downloadName } = await this.releases.fileFor(id);
    res.download(path, downloadName);
  }

  // ---------- admin ----------

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  list() {
    return this.releases.list();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, releasesDir()),
        filename: (_req, _file, cb) => cb(null, `upload-${randomUUID()}.tmp`),
      }),
      limits: { fileSize: MAX_APK_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadReleaseBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.releases.create(file, body, user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.releases.remove(id);
  }
}
