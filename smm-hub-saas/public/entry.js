(() => {
 const ref=new URLSearchParams(location.search).get('ref');if(ref&&/^[a-zA-Z0-9_-]{1,64}$/.test(ref))localStorage.setItem('smm_ref',ref.toUpperCase());
 const token=localStorage.getItem('smm_token');if(!token)return;
 fetch('/api/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'})
  .then(response=>{if(response.ok)location.replace('/painel.html'+location.hash);else if(response.status===401){localStorage.removeItem('smm_token');localStorage.removeItem('smm_user');}}).catch(()=>{});
})();
