import { BaseMutator } from './base';
import {
  LabelSpeech,
  LabelSpeechInput,
  LabelSpeechInputSchema,
} from '../schema/label-speech';

export class LabelSpeechMutator extends BaseMutator<
  LabelSpeech,
  LabelSpeechInput
> {
  constructor(pb: any) {
    super(pb);
  }

  protected getCollection() {
    return this.pb.collection('LabelSpeech');
  }

  protected async validateInput(input: LabelSpeechInput): Promise<LabelSpeechInput> {
    return LabelSpeechInputSchema.parse(input);
  }
}
