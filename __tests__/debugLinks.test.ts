import { parseDebugLink } from '../src/debug/debugLinks';

describe('parseDebugLink', () => {
  it('parses start with a name and goal', () => {
    expect(
      parseDebugLink(
        'studytimer://debug/start?name=Chapter%205+Review&goal=60',
      ),
    ).toEqual({ type: 'start', name: 'Chapter 5 Review', goalSeconds: 60 });
  });

  it('defaults the goal and name', () => {
    expect(parseDebugLink('studytimer://debug/start')).toEqual({
      type: 'start',
      name: '',
      goalSeconds: 1500,
    });
    expect(parseDebugLink('studytimer://debug/start?goal=abc')).toMatchObject({
      goalSeconds: 1500,
    });
  });

  it.each(['pause', 'resume', 'stop', 'stress'])('parses %s', cmd => {
    expect(parseDebugLink(`studytimer://debug/${cmd}`)).toEqual({ type: cmd });
  });

  it.each([
    null,
    '',
    'studytimer://open',
    'https://debug/start',
    'studytimer://debug/nope',
  ])('ignores %p', url => {
    expect(parseDebugLink(url)).toBeNull();
  });
});
