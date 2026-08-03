(function storageChecksumModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const SOURCE_FORMAT_VERSION='localstorage-shadow-source-v1';

  function storageErrors(){
    if(!root.errors)throw new Error('InvestmentStorage.errors must load before storage-checksum.js.');
    return root.errors;
  }

  function stableSerialize(value){
    if(value===null)return 'null';
    if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw storageErrors().create('validation_failed','checksum.serialize.number');
      return JSON.stringify(value);
    }
    if(Array.isArray(value))return `[${value.map(stableSerialize).join(',')}]`;
    if(typeof value==='object'){
      const prototype=Object.getPrototypeOf(value);
      if(prototype!==Object.prototype&&prototype!==null)throw storageErrors().create('validation_failed','checksum.serialize.object');
      return `{${Object.keys(value).sort().map(key=>{
        const item=value[key];
        if(item===undefined||typeof item==='function'||typeof item==='symbol')throw storageErrors().create('validation_failed','checksum.serialize.value');
        return `${JSON.stringify(key)}:${stableSerialize(item)}`;
      }).join(',')}}`;
    }
    throw storageErrors().create('validation_failed','checksum.serialize.value');
  }

  function encoder(){
    if(typeof global.TextEncoder==='function')return new global.TextEncoder();
    throw storageErrors().create('validation_failed','checksum.textEncoder');
  }

  function concatBytes(chunks){
    const length=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
    const output=new Uint8Array(length);
    let offset=0;
    chunks.forEach(chunk=>{output.set(chunk,offset);offset+=chunk.length});
    return output;
  }

  function buildSourceBytes(snapshot,keyOrder){
    if(!snapshot||typeof snapshot!=='object'||!Array.isArray(keyOrder))throw storageErrors().create('validation_failed','checksum.source.input');
    const utf8=encoder();
    const chunks=[utf8.encode(`${SOURCE_FORMAT_VERSION}\nkeys:${keyOrder.length}\n`)];
    keyOrder.forEach(key=>{
      const name=String(key);
      const present=Object.prototype.hasOwnProperty.call(snapshot,name)&&snapshot[name]!==null;
      const raw=present?snapshot[name]:'';
      if(present&&typeof raw!=='string')throw storageErrors().create('validation_failed','checksum.source.raw');
      const nameBytes=utf8.encode(name);
      const rawBytes=utf8.encode(raw);
      chunks.push(utf8.encode(`name-bytes:${nameBytes.length}\n`));
      chunks.push(nameBytes);
      chunks.push(utf8.encode(`\npresent:${present?1:0}\nraw-bytes:${rawBytes.length}\n`));
      chunks.push(rawBytes);
      chunks.push(utf8.encode('\n'));
    });
    return concatBytes(chunks);
  }

  async function sha256(bytes,options={}){
    try{
      if(typeof options.digest==='function')return String(await options.digest(bytes)).toUpperCase();
      const subtle=options.subtle||(global.crypto&&global.crypto.subtle);
      if(!subtle||typeof subtle.digest!=='function')throw storageErrors().create('validation_failed','checksum.sha256.unavailable');
      const digest=await subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
    }catch(error){
      throw storageErrors().normalize(error,'checksum.sha256','validation_failed');
    }
  }

  async function sourceChecksum(snapshot,keyOrder,options={}){
    return sha256(buildSourceBytes(snapshot,keyOrder),options);
  }

  async function semanticChecksum(envelope,options={}){
    return sha256(encoder().encode(stableSerialize(envelope)),options);
  }

  root.checksum=Object.freeze({
    SOURCE_FORMAT_VERSION,
    stableSerialize,
    buildSourceBytes,
    sha256,
    sourceChecksum,
    semanticChecksum
  });
})(typeof window!=='undefined'?window:globalThis);
