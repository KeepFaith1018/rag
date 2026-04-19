export class CreateKbDto {
  name: string;
  description?: string;
  type: 'personal' | 'shared';
  visibility: 'private' | 'invite' | 'public';
}
