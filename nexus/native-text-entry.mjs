// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Optional until the paired XGameRuntime change is pinned. Never consult a host
// installation or user's prefix: only stage the SDK-built redistribution file.
export async function stageNativeTextEntry(files, target) {
  if(!['x86_64','i386','aarch64'].includes(target.primaryPe)||!/^default_pfx(?:_[a-z0-9_]+)?$/.test(target.prefix))
    throw new Error('Invalid native text-entry staging target');
  const source=path.join(files,'lib/wine',`${target.primaryPe}-windows`,'nexus-text-entry.py');
  let content;
  try { content=await fs.readFile(source); }
  catch(error) { if(error.code==='ENOENT')return null;throw error; }
  if(!content.length||content.length>256*1024)throw new Error('Invalid native text-entry helper size');
  const directory=path.join(files,'share',target.prefix,'drive_c/windows/system32');
  await fs.mkdir(directory,{recursive:true});
  const destination=path.join(directory,'nexus-text-entry.py');
  const temporary=destination+'.nexus-runtime';
  await fs.writeFile(temporary,content,{flag:'wx',mode:0o644});
  await fs.rename(temporary,destination);
  return {sha256:createHash('sha256').update(content).digest('hex'),protocol:'native-text-entry-v3',
    hostRequirements:['python3','PyGObject','GTK4'],gameplayValidated:false};
}
