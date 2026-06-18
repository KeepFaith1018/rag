import { IsIn } from 'class-validator';

const KB_MEMBER_ROLES = ['manager', 'collaborator', 'member'] as const;

export class UpdateKbMemberDto {
  @IsIn(KB_MEMBER_ROLES)
  role!: (typeof KB_MEMBER_ROLES)[number];
}
