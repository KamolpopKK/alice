import fs from 'node:fs'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { alice, cliHome, type CliEnv } from '../helpers/cli'
import { call } from '../helpers/local'
import { capabilityAccount } from '../../src/local/capabilities'
import { readLocator } from '../../src/local/locator'
import { workspacePaths } from '../../src/local/paths'
let home: CliEnv | undefined
let pid: number | undefined
const observations: unknown[] = []
afterAll(() => { if (pid) try { process.kill(pid,'SIGTERM') } catch { /* already stopped */ }; fs.writeFileSync(path.resolve('.alice-test/project-knowledge/docs-examples.json'),JSON.stringify(observations,null,2)) })
it('runs the guide CLI commands and API read examples in an isolated Local workspace and checks repository links',async()=>{
 home=cliHome('knowledge-doc-examples')
 const run=async(args:string[])=>{const r=await alice(home!,args);expect(r.code,r.stderr).toBe(0);return JSON.parse(r.stdout).data}
 const ws=await run(['workspace','create','--json'])
 const p=await run(['--workspace','personal','project','create','--name','Guide','--json'])
 const d=await run(['--workspace','personal','document','create','--title','Authentication','--body','# Authentication\nOverview evidence.','--json'])
 const locator=readLocator(workspacePaths(home.env.ALICE_HOME,ws.id).locator)!;pid=locator.pid
 const token=JSON.parse(fs.readFileSync(home.credentialFile,'utf8'))[capabilityAccount(ws.id,'owner')]
 const base=`http://127.0.0.1:${locator.port}`
 expect((await call(base,'/local/v1/integrations/codex',{token,body:{enabled:true}})).status).toBe(200)
 const guide=fs.readFileSync('docs/project-knowledge.md','utf8')
 const commands=[...guide.matchAll(/^alice .+$/gm)].map((m)=>m[0])
 expect(commands).toHaveLength(9)
 let topic=''
 for(const command of commands){
  const args=command.replaceAll('$PROJECT',p.id).replaceAll('$DOCUMENT',d.id).replaceAll('$TOPIC',topic).split(/\s+/).slice(1)
  const result=await run(args)
  if(args.includes('create'))topic=result.topic.id
  observations.push({command,result})
 }
 for(const endpoint of [`/client/v1/projects/${p.id}/knowledge/context`,`/client/v1/documents/${d.id}/content?expectedRevision=1&offset=0&maxChars=100`,`/client/v1/documents/${d.id}/outline`,`/client/v1/documents/${d.id}/preview`]){
  const result=await call(base,endpoint,{token});expect(result.status).toBe(200);observations.push({endpoint,result:result.data})
 }
 for(const match of guide.matchAll(/\]\(([^)]+)\)/g)){
  const link=match[1];if(link.startsWith('/')||link.startsWith('http')||link.startsWith('#'))continue
  expect(fs.existsSync(path.resolve('docs',link.split('#')[0])),link).toBe(true)
 }
})
