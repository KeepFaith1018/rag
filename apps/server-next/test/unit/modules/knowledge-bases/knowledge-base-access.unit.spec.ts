import { KnowledgeBaseAccessService } from '@app/modules/knowledge-bases/services/knowledge-base-access.service';

describe('knowledge base access policy', () => {
  const service = new KnowledgeBaseAccessService({} as never);
  const subject = {
    id: 1n,
    owner_id: 10n,
    visibility: 'collaborative' as const,
    allow_public_download: false,
    deleted_at: null,
    kb_members: [
      { user_id: 20n, role: 'manager' as const },
      { user_id: 30n, role: 'collaborator' as const },
      { user_id: 40n, role: 'member' as const },
    ],
  };

  it('resolves only current schema roles without fallback coercion', () => {
    expect(service.resolve(subject, 10n)).toBe('owner');
    expect(service.resolve(subject, 20n)).toBe('manager');
    expect(service.resolve(subject, 30n)).toBe('collaborator');
    expect(service.resolve(subject, 40n)).toBe('member');
    expect(service.resolve(subject, 50n)).toBeNull();
  });

  it('allows public visitors only for public knowledge bases', () => {
    expect(service.resolve({ ...subject, visibility: 'public' }, 50n)).toBe(
      'publicVisitor',
    );
    expect(
      service.resolve({ ...subject, visibility: 'private' }, 50n),
    ).toBeNull();
  });

  it('builds least-privilege permission flags', () => {
    expect(
      service.permissions('manager', 'collaborative', false),
    ).toMatchObject({
      canManageMembers: true,
      canEdit: false,
      canUpload: true,
    });
    expect(
      service.permissions('collaborator', 'collaborative', false),
    ).toMatchObject({ canManageMembers: false, canUpload: true });
    expect(service.permissions('member', 'public', false)).toMatchObject({
      canUpload: false,
      canDownload: true,
    });
    expect(service.permissions('publicVisitor', 'public', false)).toMatchObject(
      {
        canView: true,
        canUpload: false,
        canDownload: false,
      },
    );
  });
});
