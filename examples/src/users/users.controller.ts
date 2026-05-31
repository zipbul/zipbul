import { UseGuards, UseMiddlewares } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { RestController, Get, Post, Put, Delete, type HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { IdRouteParams } from '../dto/id-route-params.dto';
import type { ComplexCreateResponse, User } from './interfaces';

import { authGuard } from '../guards/auth.guard';
import { AddressDto } from './dto/address.dto';
import { CreateUserComplexDto } from './dto/complex.dto';
import { SocialDto } from './dto/social.dto';
import { UsersAuditService } from './audit.service';
import { sessionMiddleware } from './session.middleware';
import { SessionContext } from './session-context';
import { UsersService } from './users.service';

@RestController('users')
export class UsersController {
  private readonly logger = new Logger('UsersController');
  private readonly auditService = inject(UsersAuditService);
  private readonly usersService = inject(UsersService);

  @Get()
  getAll(): ReadonlyArray<User> {
    return this.usersService.findAll();
  }

  @Post('complex')
  complexCreate(ctx: HttpContext): ComplexCreateResponse<CreateUserComplexDto> {
    const body = ctx.request.getBody(CreateUserComplexDto);

    this.logger.info('Complex Data Received:', JSON.stringify(body));

    return {
      message: 'Validated and Transformed!',
      data: body,
      isNameString: typeof body.name === 'string',
      isAgeNumber: typeof body.age === 'number',
      isAddressInstance: body.addresses?.[0] instanceof AddressDto,
      isSocialInstance: body.social instanceof SocialDto,
    };
  }

  @Get(':id')
  getById(ctx: HttpContext): User | undefined {
    const params = ctx.request.getParams(IdRouteParams);

    return this.usersService.findOneById(Number(params.id));
  }

  @Post()
  create(ctx: HttpContext): void {
    this.usersService.create(ctx.request.body as unknown as User);
  }

  @Put(':id')
  update(ctx: HttpContext): void {
    const params = ctx.request.getParams(IdRouteParams);

    this.usersService.update(Number(params.id), ctx.request.body as unknown as User);
  }

  @Delete(':id')
  @UseGuards(authGuard)
  @UseMiddlewares('BeforeHandle', [sessionMiddleware])
  delete(ctx: HttpContext): { readonly deletedUserId: number; readonly bySessionUserId: number; readonly token: string } {
    const params = ctx.request.getParams(IdRouteParams);
    const session = ctx.use(SessionContext);

    this.auditService.logAction('delete', `userId=${params.id} by=${session.userId}`);
    this.usersService.delete(Number(params.id));

    return { deletedUserId: Number(params.id), bySessionUserId: session.userId, token: session.token };
  }
}
