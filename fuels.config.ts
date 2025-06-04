import { createConfig } from 'fuels';

export default createConfig({
  scripts: ['./sway/script-test'],
  predicates: ['./sway/predicate-test'],
  forcBuildFlags: ['--release'],
  output: './artifacts',
});
