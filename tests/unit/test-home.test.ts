import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { cliHome } from '../helpers/cli'
import { localEnv, localHome } from '../helpers/local'

// skill, launcher และ config ของ agent อยู่ใต้ HOME: test ต้องไม่แตะ home จริงของคนรัน
describe('test home directory', () => {
  const real = os.userInfo().homedir

  it('is a temporary directory in tests and in the CLI and Local processes they start', () => {
    expect(os.homedir()).not.toBe(real)
    expect(cliHome().env.HOME).not.toBe(real)
    expect(localEnv(localHome()).HOME).not.toBe(real)
  })
})
