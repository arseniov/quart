import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { AdminAuditController } from './admin-audit.controller.js';
import { AdminCitiesController } from './admin-cities.controller.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDlqController } from './admin-dlq.controller.js';
import { AdminI18nController } from './admin-i18n.controller.js';
import { AdminIdeasController } from './admin-ideas.controller.js';
import { AdminOfficersController } from './admin-officers.controller.js';
import { AdminPollsController } from './admin-polls.controller.js';
import { AdminRolesController } from './admin-roles.controller.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminTaxonomiesController } from './admin-taxonomies.controller.js';
import { AdminUsersController } from './admin-users.controller.js';

/**
 * Aggregates the admin-only controllers across the domain surface. Each
 * sub-controller gates itself with `@UseGuards(JwtAuthGuard, MfaGuard,
 * RbacGuard)` + `@RequirePermission(...)` so the AppModule-level wiring
 * stays minimal — just import this module once.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    AdminPollsController,
    AdminIdeasController,
    AdminUsersController,
    AdminRolesController,
    AdminTaxonomiesController,
    AdminCitiesController,
    AdminOfficersController,
    AdminAuditController,
    AdminSettingsController,
    AdminI18nController,
    AdminDashboardController,
    AdminDlqController,
  ],
})
export class AdminModule {}
