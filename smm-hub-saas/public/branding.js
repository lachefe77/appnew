document.addEventListener('DOMContentLoaded',async()=>{
 try{const response=await fetch('/api/site/brand');if(!response.ok)return;const {name}=await response.json();if(typeof name!=='string'||name==='SMM Hub')return;for(const node of document.querySelectorAll('.logo,.brand-logo')){const text=[...node.childNodes].find(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim());if(text)text.textContent=' '+name+' ';}document.title=document.title.replace(/SMM Hub/gi,name);}catch{}
});
