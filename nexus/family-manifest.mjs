// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileHash} from './ci/provenance.mjs';
import {targets} from './target.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,file)=>file.startsWith(root+path.sep);
// Managed family arch names are launcher-facing; target names stay the build
// names. x64 keeps its historical narrower file list, arm64 carries its real
// three PE directories in the same required inventory.
const inventoryArch=target=>target.name==='arm64'?['aarch64','x86_64','i386']:['x86_64','i386'];
// The complete required launch payload for one real target layout.
export function managedCriticalFiles(target){
  if(![...Object.values(targets)].includes(target))throw Error('Unsupported managed target layout');
  return Object.freeze(['proton',`files/${target.bin}/wine`,`files/${target.bin}/wineserver`,`files/${target.bin}/wine.nexus-original`,'XODUS_NEXUS_PATCH.json',
    ...['PlayFabGameSave.dll','gaming-services-version.exe','package-registration.exe'].map(n=>'files/share/xodus-nexus/compat/'+n),
    ...inventoryArch(target).flatMap(cpu=>['xgameruntime.dll','winhttp.dll','libnghttp2.dll'].map(n=>`files/lib/wine/${cpu}-windows/${n}`))]);
}
export async function writeFamilyManifest(runtime,{family,repository='domsvoboda/nexus-runtime',sourceRepository='domsvoboda/nexus-runtime',sourceCommit,sourceLockSha256,arch}){
  if(family!=='nexus'||repository!=='domsvoboda/nexus-runtime'||sourceRepository!=='domsvoboda/nexus-runtime'||!/^[a-f0-9]{40}$/.test(sourceCommit)||!/^[a-f0-9]{64}$/.test(sourceLockSha256))throw Error('Exact managed Standard source identity required');
  const target=arch==='x64'?targets.x86_64:arch==='arm64'?targets.arm64:undefined;
  if(!target)throw Error('Managed family architecture must be x64 or arm64');
  const root=await fs.realpath(runtime),files={},symlinks={};
  const metadata=JSON.parse(await fs.readFile(path.join(root,'XODUS_NEXUS_PATCH.json'),'utf8'));
  if(metadata.schema!==1||metadata.sourceGraph?.proton!==sourceCommit||metadata.sourceLockSha256!==sourceLockSha256)throw Error('Managed source identity disagrees with assembled metadata');
  // The assembled metadata must describe the same real layout, so an x64 tree
  // can never be relabelled as ARM64 (or the reverse).
  if((arch==='arm64')!==(metadata.targetArchitecture==='arm64'))throw Error('Managed family architecture disagrees with the assembled runtime');
  async function scan(directory){
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=path.join(directory,entry.name),name=path.relative(root,file).split(path.sep).join('/');
      if(name==='nexus-family.json')throw Error('Managed family manifest already exists');
      if(name.includes('\\'))throw Error('Unsupported managed payload path');
      if(entry.isDirectory())await scan(file);
      else if(entry.isFile())files[name]=await fileHash(file);
      else if(entry.isSymbolicLink()){
        const value=await fs.readlink(file);
        // Only the inert template drive mapping may name the host root.
        const templateMapping=name==='files/share/'+target.prefix+'/dosdevices/z:'&&value==='/';
        if(!templateMapping&&(path.isAbsolute(value)||!inside(root,await fs.realpath(file))))throw Error('External managed payload link: '+name);
        symlinks[name]=value;
      }else throw Error('Unsupported managed payload entry: '+name);
    }
  }
  await scan(root);
  for(const file of managedCriticalFiles(target))if(!files[file])throw Error('Managed launch payload incomplete: '+file);
  if(!(await fs.lstat(path.join(root,'files/share',target.prefix))).isDirectory())throw Error('Managed default prefix is not a real directory');
  for(const file of ['proton',`files/${target.bin}/wine`,`files/${target.bin}/wineserver`])await fs.access(path.join(root,file),fs.constants.X_OK);
  // The receipt is packaging metadata for this family/architecture only.
  const identity={schema:1,family,sourceRepository,sourceCommit,arch,prefixSchema:1,sourceLockSha256,files,symlinks};
  const buildId=digest(JSON.stringify(identity));
  const manifest={...identity,buildId},bytes=JSON.stringify(manifest,null,2)+'\n';
  await fs.writeFile(path.join(root,'nexus-family.json'),bytes,{flag:'wx'});
  // This is packaging metadata only. The caller never writes or activates current.json.
  return {schema:1,family,sourceRepository,sourceCommit,arch,buildId,manifestSha256:digest(bytes)};
}
