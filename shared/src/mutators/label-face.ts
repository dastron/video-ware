import { BaseMutator } from './base';
import {
  LabelFace,
  LabelFaceInput,
  LabelFaceInputSchema,
} from '../schema/label-face';

export class LabelFaceMutator extends BaseMutator<
  LabelFace,
  LabelFaceInput
> {
  constructor(pb: any) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelFaces');
  }

  protected async validateInput(input: LabelFaceInput): Promise<LabelFaceInput> {
    return LabelFaceInputSchema.parse(input);
  }
}
