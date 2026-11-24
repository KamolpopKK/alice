import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, type HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'
let app: RunningApp, owner: HttpClient, mcp: McpHandle
const transcript: unknown[] = []
const act = async (tool: string, args: Record<string, unknown>) => { const result = await mcp.ok(tool,args);transcript.push({tool,args,result});return result }
beforeAll(async()=>{app=await startApp();owner=await bootstrapOwner(app);mcp=await connectMcp(app.url,(await createAgent(owner,'Scenario curator')).token)})
afterAll(async()=>{await mcp?.close();await app?.stop();fs.writeFileSync(path.resolve('.alice-test/project-knowledge/approval-scenarios.json'),JSON.stringify({method:'Scripted contract walkthrough reviewed against the shared guidance; not an autonomous model evaluation.',transcript},null,2))})
it('keeps proposal/rejection read-only, applies only approved subset and never treats curation/content as review',async()=>{
 const p=(await owner.post('/api/projects',{name:'Isolated approval fixture'})).body.project
 const a=(await owner.post('/api/documents',{title:'Approved source',body:'Original reviewed evidence.'})).body.document
 const b=(await owner.post('/api/documents',{title:'Unapproved source',body:'Do not change.'})).body.document
 for(const d of [a,b])await owner.post(`/api/documents/${d.id}/review`,{expectedRevision:1})
 const beforeA=(await owner.get(`/api/documents/${a.id}`)).body.document,beforeB=(await owner.get(`/api/documents/${b.id}`)).body.document
 transcript.push({prompt:'Propose a reading topic for these two sources; do not apply changes.',proposal:{project:p.id,add:[a.id,b.id]},approval:'pending'})
 await act('get_document',{id:a.id,expectedRevision:1});await act('get_document',{id:b.id,expectedRevision:1})
 expect((await owner.get(`/client/v1/projects/${p.id}/knowledge/topics`)).body.items).toEqual([])
 transcript.push({prompt:'Reject the proposed content edits; approve only a topic containing Approved source.',approval:{topic:'Start here',members:[a.id],contentEdits:false}})
 const t=(await act('create_knowledge_topic',{projectId:p.id,name:'Start here',mutationId:crypto.randomUUID()})).topic
 await act('put_topic_document',{topicId:t.id,documentId:a.id,expectedRevision:1,mutationId:crypto.randomUUID()})
 expect((await owner.get(`/api/documents/${a.id}`)).body.document).toEqual(beforeA)
 expect((await owner.get(`/api/documents/${b.id}`)).body.document).toEqual(beforeB)
 expect((await act('list_topic_documents',{topicId:t.id})).items.map((x:any)=>x.document.id)).toEqual([a.id])
 transcript.push({prompt:'Approve replacing Approved source body with clarified evidence; do not review/archive/supersede anything.',sourceRevision:1})
 await act('get_document',{id:a.id,expectedRevision:1})
 const changed=await act('update_document',{id:a.id,body:'Clarified evidence.'})
 expect(changed.document).toMatchObject({revision:2,status:'unreviewed',reviewedRevision:null,archivedAt:null})
 expect((await owner.get(`/api/documents/${b.id}`)).body.document).toEqual(beforeB)
 const stale=await mcp.call('get_document',{id:a.id,expectedRevision:1});expect(stale.isError).toBe(true)
 transcript.push({observation:'Old revision continuation conflicted; dependent citation is restarted, not forced.',result:stale})
 expect((await act('list_document_relations',{id:a.id,direction:'outgoing'})).items).toEqual([])
})
