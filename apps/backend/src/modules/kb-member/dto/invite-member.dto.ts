export class InviteMemberDto {
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}
