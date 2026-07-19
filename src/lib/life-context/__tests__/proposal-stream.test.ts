import { LIFE_CONTEXT_BLOCK_START } from '../model-proposals';
import { LifeContextProposalHoldback } from '../proposal-stream';

function streamAt(text: string, size: number): string {
  const holdback = new LifeContextProposalHoldback();
  let visible = '';
  for (let i = 0; i < text.length; i += size) visible += holdback.push(text.slice(i, i + size));
  return visible + holdback.flush();
}

describe('LifeContextProposalHoldback', () => {
  it.each([1, 2, 3, 7, LIFE_CONTEXT_BLOCK_START.length, 64])(
    'withholds proposal blocks across chunk size %i',
    (size) => expect(streamAt(`Visible answer.${LIFE_CONTEXT_BLOCK_START}[{"x":1}]`, size)).toBe('Visible answer.'),
  );

  it('handles a chunk boundary landing exactly on the block-start marker', () => {
    const holdback = new LifeContextProposalHoldback();
    expect(holdback.push('Visible answer.')).toBe('Visible answer.');
    expect(holdback.push(LIFE_CONTEXT_BLOCK_START)).toBe('');
    expect(holdback.push('[{"private":true}]')).toBe('');
    expect(holdback.flush()).toBe('');
  });

  it.each([1, 2, 5, 17])('releases marker-like visible text when the prefix diverges (chunk size %i)', (size) => {
    const lookalike = 'Use <life_context_project> as the folder name.';
    expect(streamAt(lookalike, size)).toBe(lookalike);
  });
});
