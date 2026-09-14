import { Body, Controller, Delete, Get, Header, Param, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import { Locale, PutTranslationBody } from './i18n.dto.js';
import type { TranslationPayload } from './i18n.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the I18nService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { I18nService } from './i18n.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
@Controller('i18n')
@ApiGlobalResponses()
@ApiTags('i18n')
@ApiBearerAuth('bearer')
export class I18nController {
  constructor(private readonly svc: I18nService) {}

  // Read endpoints are public — the mobile app bundles a default locale
  // and falls back to it if the server returns an empty dict.
  @Get('mobile')
  async listLocales(): Promise<{ locales: string[] }> {
    const locales = await this.svc.listLocales();
    return { locales };
  }

  @Get('mobile/:locale')
  @Header('Cache-Control', 'public, max-age=3600')
  async get(@Param('locale', new ZodValidationPipe(Locale)) locale: string): Promise<TranslationPayload> {
    return this.svc.get(locale);
  }

  @Put('mobile/:locale')
  @UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
  @RequirePermission('admin.i18n.write')
  async upsert(
    @CurrentUser() user: AuthUser,
    @Param('locale', new ZodValidationPipe(Locale)) locale: string,
    @Body(new ZodValidationPipe(PutTranslationBody)) body: PutTranslationBody,
  ): Promise<{ locale: string; translations: TranslationPayload }> {
    const translations = await this.svc.upsert(user, locale, body.translations);
    return { locale, translations };
  }

  @Delete('mobile/:locale')
  @UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
  @RequirePermission('admin.i18n.write')
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('locale', new ZodValidationPipe(Locale)) locale: string,
  ): Promise<void> {
    await this.svc.delete(user, locale);
  }
}
