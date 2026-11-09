const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const origin='http://fulfillment.test';
function mockSDK(config){
  let user=config.session?{id:'test-user',email:'test@example.test'}:null;
  const listeners=[];
  window.calls=[];
  window.supabase={createClient:(_url,_key,options)=>{
    window.sdkStorage=options.auth.storage;
    const profile=config.inactive?{display_name:'Test account',role:'staff',is_active:false}:{display_name:'Test account',role:'staff',is_active:true};
    const auth={
      onAuthStateChange:fn=>{listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}}},
      getSession:async()=>{if(config.callbackReject)throw Error('offline');return {data:{session:user?{user}:null},error:null}},
      getUser:async()=>{if(config.userReject)throw Error('offline');return {data:{user},error:null}},
      signInWithPassword:async values=>{window.calls.push(['signIn',values]);if(config.loginReject)throw Error('offline');if(config.invalidLogin)return {data:{user:null},error:{message:'Invalid login credentials'}};user={id:'test-user',email:values.email};return {data:{user},error:null}},
      updateUser:async values=>{window.calls.push(['updateUser',values]);if(config.updateReject)throw Error('offline');return {data:{user},error:config.updateError?{message:'Password update rejected'}:null}},
      signOut:async options=>{window.calls.push(['signOut',options]);if(config.logoutReject)throw Error('offline');user=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));return {error:null}},
      resetPasswordForEmail:async(email,opts)=>{window.calls.push(['reset',email,opts]);if(config.resetReject)throw Error('offline');return {error:config.rateLimit?{status:429}:null}}
    };
    return {auth,from:table=>({
      select:()=>({eq:()=>({maybeSingle:async()=>({data:profile,error:config.profileError?{message:'offline'}:null})})}),
      insert:async values=>{window.calls.push(['insert',table,values]);if(config.insertReject)throw Error('offline');return {error:config.insertError?{message:'denied'}:null}}
    })};
  }};
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:["--no-sandbox","--disable-dev-shm-usage"]}:{})});let count=0;
 async function scenario(name,config,hash,run){
   const page=await browser.newPage();const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
     const url=route.request().url();
     if(url.startsWith(origin))return route.fulfill({contentType:'text/html',body:html});
     if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:`(${mockSDK.toString()})(${JSON.stringify(config)})`});
     return route.abort();
   });
   await page.goto(origin+'/'+hash);
   try{await run(page);assert.deepEqual(errors,[]);count++;console.log('PASS',name)}finally{await page.close()}
 }
 async function login(p){await p.getByLabel('Email',{exact:true}).fill('test@example.test');await p.getByLabel('Password',{exact:true}).fill('test-password');await p.getByRole('button',{name:'Sign in',exact:true}).click()}
 async function request(p){await p.getByLabel('Full name').fill('Test account');await p.getByLabel('Email',{exact:true}).fill('TEST@example.test');await p.getByLabel('Requested access level').selectOption('staff');await p.getByRole('button',{name:'Send access request'}).click()}
 async function password(p){await p.getByLabel('New password',{exact:true}).fill('new-test-password');await p.getByLabel('Confirm password').fill('new-test-password');await p.getByRole('button',{name:'Save password'}).click()}
 async function status(p,selector,text){await p.locator(selector).filter({hasText:text}).waitFor()}
 try{
 await scenario('navigation connects sign-in, reset and request pages',{},'#sign-in',async p=>{await p.getByRole('link',{name:'Forgot password?'}).click();await p.locator('#recovery-form').waitFor();await p.getByRole('link',{name:'Back to sign in'}).click();await p.locator('.auth-links').getByRole('link',{name:'Request access'}).click();await p.locator('#access-request-form').waitFor()});
 await scenario('successful login, workspace role and logout',{},'#sign-in',async p=>{await login(p);await status(p,'#workspace-status','Signed in as');assert.equal(await p.locator('#workspace-role').textContent(),'staff');await p.getByRole('button',{name:'Log out'}).click();await p.locator('#sign-in-form').waitFor()});
 await scenario('inactive account cannot enter workspace',{inactive:true},'#sign-in',async p=>{await login(p);await status(p,'#signin-status','awaiting activation');assert.match(p.url(),/#sign-in$/)});
 await scenario('invalid login shows error and permits retry',{invalidLogin:true},'#sign-in',async p=>{await login(p);await status(p,'#signin-status','Invalid login');assert(await p.locator('#signin-submit').isEnabled())});
 await scenario('login network failure recovers submit',{loginReject:true},'#sign-in',async p=>{await login(p);await status(p,'#signin-status','Connection interrupted');assert(await p.locator('#signin-submit').isEnabled())});
 await scenario('unauthenticated workspace redirects',{},'#workspace',async p=>{await p.locator('#sign-in-form').waitFor()});
 await scenario('workspace network error stays recoverable',{session:true,userReject:true},'#workspace',async p=>{await status(p,'#workspace-status','Connection interrupted');assert(await p.getByRole('button',{name:'Log out'}).isEnabled())});
 await scenario('logout failure allows retry',{session:true,logoutReject:true},'#workspace',async p=>{await status(p,'#workspace-status','Signed in as');await p.getByRole('button',{name:'Log out'}).click();await status(p,'#workspace-status','Could not log out');assert(await p.getByRole('button',{name:'Log out'}).isEnabled())});
 await scenario('access request submits only pending requested role',{},'#request-access',async p=>{await request(p);await status(p,'#request-status','Request received');const calls=await p.evaluate(()=>window.calls);assert.deepEqual(calls[0],['insert','access_requests',{full_name:'Test account',email:'test@example.test',requested_role:'staff',message:'',status:'pending'}])});
 await scenario('access request failure is retryable',{insertReject:true},'#request-access',async p=>{await request(p);await status(p,'#request-status','Connection interrupted');assert(await p.locator('#request-submit').isEnabled())});
 await scenario('reset submits canonical callback URL',{},'#forgot-password',async p=>{await p.getByLabel('Email address').fill('test@example.test');await p.getByRole('button',{name:'Send reset link'}).click();await status(p,'.auth-status','If this email has an account');const calls=await p.evaluate(()=>window.calls);assert.equal(calls[0][2].redirectTo,origin+'/')});
 await scenario('reset rate limit handled',{rateLimit:true},'#forgot-password',async p=>{await p.getByLabel('Email address').fill('test@example.test');await p.getByRole('button',{name:'Send reset link'}).click();await status(p,'.auth-status','Too many requests');assert(await p.getByRole('button',{name:'Send reset link'}).isEnabled())});
 await scenario('expired callback overrides existing session',{session:true},'#error=access_denied&error_description=Link+expired',async p=>{await status(p,'#recovery-form .auth-status','Link expired');assert.match(p.url(),/#forgot-password$/)});
 await scenario('valid recovery callback routes and strips tokens',{session:true},'#access_token=fake-test-token&type=recovery',async p=>{await p.locator('#set-password-form').waitFor();assert.match(p.url(),/#set-password$/);assert(!p.url().includes('token'));await password(p);await status(p,'#workspace-status','Signed in as')});
 await scenario('callback without session reports expired link',{},'#access_token=fake-test-token&type=recovery',async p=>{await status(p,'#recovery-form .auth-status','invalid or expired')});
 await scenario('direct password page disables invalid session',{},'#set-password',async p=>{await status(p,'#set-password-status','invalid or expired');assert(!(await p.locator('#set-password-submit').isEnabled()));assert.equal(await p.getByRole('link',{name:'Request a new reset link'}).count(),1)});
 await scenario('password mismatch does not call update',{session:true},'#set-password',async p=>{await p.getByLabel('New password',{exact:true}).fill('new-test-password');await p.getByLabel('Confirm password').fill('different-password');await p.getByRole('button',{name:'Save password'}).click();await status(p,'#set-password-status','do not match');assert.equal((await p.evaluate(()=>window.calls)).length,0)});
 await scenario('password network failure recovers button',{session:true,updateReject:true},'#set-password',async p=>{await password(p);await status(p,'#set-password-status','Connection interrupted');assert(await p.locator('#set-password-submit').isEnabled())});
 await scenario('inactive recovery account remains gated',{session:true,inactive:true},'#set-password',async p=>{await password(p);await status(p,'#signin-status','awaiting activation')});
 await scenario('workspace re-entry after homepage rechecks session',{session:true},'#workspace',async p=>{await status(p,'#workspace-status','Signed in as');await p.goto(origin+'/#');await p.goto(origin+'/#workspace');await status(p,'#workspace-status','Signed in as');assert(await p.getByRole('button',{name:'Log out'}).isEnabled())});
 console.log(`${count} browser flow tests passed. Supabase is mocked; these are not live backend tests.`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
