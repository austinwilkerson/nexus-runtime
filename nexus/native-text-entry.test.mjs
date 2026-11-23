// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stageNativeTextEntry} from './native-text-entry.mjs';
const target={primaryPe:'x86_64',prefix:'default_pfx'};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-native-entry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('older pinned components remain unchanged when no helper was built',async t=>{
  const root=await fixture(t);assert.equal(await stageNativeTextEntry(root,target),null);
  assert.deepEqual(await fs.readdir(root),[]);
});
test('helper bytes staged from the matching architecture have an auditable checksum',async t=>{
  const root=await fixture(t),source=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(source,{recursive:true});
  const content=Buffer.from('# SPDX-License-Identifier: LGPL-2.1-or-later\nprint("fixture")\n');await fs.writeFile(path.join(source,'nexus-text-entry.py'),content);
  const result=await stageNativeTextEntry(root,target);
  assert.equal(result.sha256,createHash('sha256').update(content).digest('hex'));
  assert.equal(result.gameplayValidated,false);
  assert.deepEqual(await fs.readFile(path.join(root,'share/default_pfx/drive_c/windows/system32/nexus-text-entry.py')),content);
  assert.equal((await fs.stat(path.join(root,'share/default_pfx/drive_c/windows/system32/nexus-text-entry.py'))).mode&0o777,0o644);
});
test('invalid targets and unreasonable helpers fail closed',async t=>{
  const root=await fixture(t);
  await assert.rejects(stageNativeTextEntry(root,{...target,prefix:'../../host'}),/Invalid/);
  await assert.rejects(stageNativeTextEntry(root,{...target,primaryPe:'../host'}),/Invalid/);
  const directory=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'nexus-text-entry.py'),Buffer.alloc(256*1024+1));
  await assert.rejects(stageNativeTextEntry(root,target),/size/);
});
