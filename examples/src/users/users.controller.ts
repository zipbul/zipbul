import { inject, UseGuards } from '@zipbul/common';
import { RestController, Get, Post, Put, Delete, type HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { IdRouteParams } from '../dto/id-route-params.dto';
import type { ComplexCreateResponse, User } from './interfaces';

import { authGuard } from '../guards/auth.guard';
import { AddressDto } from './dto/address.dto';
import { CreateUserComplexDto } from './dto/complex.dto';
import { SocialDto } from './dto/social.dto';
import { AuditService } from './audit.service';
import { UsersService } from './users.service';

@RestController('users')
export class UsersController {
  private readonly logger = new Logger('UsersController');
  private readonly auditService = inject(AuditService);
  constructor(private readonly usersService: UsersService) {}

  @Get()
  getAll(): ReadonlyArray<User> {
    return this.usersService.findAll();
  }

  @Post('complex')
  complexCreate(ctx: HttpContext): ComplexCreateResponse<CreateUserComplexDto> {
    const body = ctx.getBody<CreateUserComplexDto>();

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
    const params = ctx.getParams<IdRouteParams>();

    return this.usersService.findOneById(Number(params.id));
  }

  @Post()
  create(ctx: HttpContext): void {
    this.usersService.create(ctx.request.body as User);
  }

  @Put(':id')
  update(ctx: HttpContext): void {
    const params = ctx.getParams<IdRouteParams>();

    this.usersService.update(Number(params.id), ctx.request.body as User);
  }

  @Delete(':id')
  @UseGuards(authGuard)
  delete(ctx: HttpContext): void {
    const params = ctx.getParams<IdRouteParams>();

    this.auditService.logAction('delete', `userId=${params.id}`);
    this.usersService.delete(Number(params.id));
  }
}
