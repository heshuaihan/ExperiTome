// SPDX-License-Identifier: MIT
import {importLocal} from './import.mjs';
self.onmessage=async({data})=>{try{const dataset=await importLocal(data.file,data.options,message=>self.postMessage({type:'progress',message}));self.postMessage({type:'result',dataset});}catch(error){self.postMessage({type:'error',message:error.message||String(error)});}};
