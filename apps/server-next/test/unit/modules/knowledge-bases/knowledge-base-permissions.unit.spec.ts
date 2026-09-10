import { KnowledgeBaseAccessService } from '@app/modules/knowledge-bases/services/knowledge-base-access.service';
import type {
  KnowledgeBaseAccessRole,
  KnowledgeBaseVisibility,
} from '@app/modules/knowledge-bases/contracts/knowledge-base-access';

describe('knowledge base permission matrix', () => {
  const service = new KnowledgeBaseAccessService({} as never);
  const roles: KnowledgeBaseAccessRole[] = [
    'owner',
    'manager',
    'collaborator',
    'member',
    'publicVisitor',
  ];
  const visibilities: KnowledgeBaseVisibility[] = [
    'private',
    'collaborative',
    'public',
  ];

  it.each(
    roles.flatMap((role) =>
      visibilities.map((visibility) => [role, visibility] as const),
    ),
  )('%s on %s follows least privilege', (role, visibility) => {
    const permissions = service.permissions(role, visibility, false);
    expect(permissions.canView).toBe(true);
    expect(permissions.canAsk).toBe(true);
    expect(permissions.canEdit).toBe(role === 'owner');
    expect(permissions.canDelete).toBe(role === 'owner');
    expect(permissions.canManageKnowledgeBase).toBe(role === 'owner');
    expect(permissions.canUpload).toBe(
      ['owner', 'manager', 'collaborator'].includes(role),
    );
    expect(permissions.canDownload).toBe(role !== 'publicVisitor');
    expect(permissions.canManageMembers).toBe(
      ['owner', 'manager'].includes(role) && visibility !== 'private',
    );
  });

  it('allows public download only when explicitly enabled', () => {
    expect(
      service.permissions('publicVisitor', 'public', true).canDownload,
    ).toBe(true);
    expect(
      service.permissions('publicVisitor', 'collaborative', true).canDownload,
    ).toBe(true);
  });
});
