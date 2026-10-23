(() => {
 const token=localStorage.getItem('smm_token');
 if(!token||token==='browser-session')return;
 fetch('/api/auth/browser-session',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Session-Transport':'cookie','Content-Type':'application/json'}}).then(async response=>{if(!response.ok)return;const data=await response.json();if(data.token!=='browser-session')return;localStorage.setItem('smm_token',data.token);if(typeof state!=='undefined')state.token=data.token;}).catch(()=>{});
})();
