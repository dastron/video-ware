import { RecordService } from 'pocketbase';
import type { Workspace, WorkspaceInput } from '@project/shared';
import { WorkspaceInputSchema } from '@project/shared';
import type { TypedPocketBase } from '@/lib/types';
import { BaseMutator, type MutatorOptions } from './base';

export class WorkspaceMutator extends BaseMutator<Workspace, WorkspaceInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Workspace> {
    return this.pb.collection('Workspaces');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: WorkspaceInput
  ): Promise<WorkspaceInput> {
    return WorkspaceInputSchema.parse(input);
  }

  /**
   * Get workspace by slug
   * @param slug The workspace slug
   * @returns The workspace or null if not found
   */
  async getBySlug(slug: string): Promise<Workspace | null> {
    return this.getFirstByFilter(`slug = "${slug}"`);
  }
}
