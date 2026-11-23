import os,sys,subprocess,time,json,urllib.request
from playwright.sync_api import sync_playwright
case=sys.argv[1] if len(sys.argv)>1 else 'all'
os.environ.update(APP_PRIME_ALLOW_NEW_DATABASE='1',JWT_SECRET='isolated-skills-fixture',MFA_ENCRYPTION_KEY='isolated-skills-mfa',SEED_ADMIN_EMAIL='fixture@example.invalid',SEED_ADMIN_PASSWORD='fixture-password',PORT='4100',NODE_ENV='production')
assert os.environ.get('SKILLS_FIXTURE')=='1'
assert not os.path.exists('/proc/1/root/root/.hermes')
log=open('/evidence/repair-ui-server.log','w');server=subprocess.Popen(['node','server/index.js'],stdout=log,stderr=log)
try:
 for i in range(100):
  try:urllib.request.urlopen('http://127.0.0.1:4100/api/health');break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('server unavailable')
 subprocess.run(['node','/evidence/seed-browser.mjs'],check=True)
 fixture=json.load(open('/tmp/browser-fixture.json'))
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/browser/chrome-linux64/chrome',args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1440,'height':1000})
  context.add_cookies([{'name':'app_prime_session','value':fixture['tokens']['admin'],'url':'http://127.0.0.1:4100'}])
  page=context.new_page()
  def open_matrix():
   page.goto('http://127.0.0.1:4100/primes');page.get_by_role('button',name='Maîtrise de polyvalence',exact=True).click();page.get_by_role('table',name='Matrice de polyvalence').wait_for()
  def create_draft(name):
   page.get_by_role('button',name='Gérer les compétences',exact=True).click();page.get_by_role('button',name='Ajouter une compétence',exact=True).click();page.get_by_label('Nom de la compétence',exact=True).fill(name)
  if case in ['stale','all']:
   open_matrix();page.get_by_label('Alice Fixture — M365',exact=True).select_option('3');page.get_by_role('status').filter(has_text='Évaluation enregistrée et relue.').wait_for()
   page.get_by_role('button',name='Profils et clients',exact=True).click();held=[]
   def hold_first(route):
    if not held:held.append((route,route.fetch()))
    else:route.continue_()
   page.route('**/api/skills',hold_first)
   page.get_by_role('button',name='Maîtrise de polyvalence',exact=True).click();page.wait_for_timeout(200);assert held
   page.get_by_role('button',name='Recharger la matrice',exact=True).click();page.get_by_role('table',name='Matrice de polyvalence').wait_for()
   page.get_by_label('Alice Fixture — M365',exact=True).select_option('4');page.get_by_role('status').filter(has_text='Évaluation enregistrée et relue.').wait_for()
   held[0][0].fulfill(response=held[0][1]);page.wait_for_timeout(200)
   actual=context.request.get('http://127.0.0.1:4100/api/skills').json()
   assert next(e['level'] for e in actual['evaluations'] if e['primeId']==fixture['a'] and e['competenceId']=='ti-1')==4
   assert page.get_by_label('Alice Fixture — M365',exact=True).input_value()=='4','late initial GET overwrote saved state'
   page.unroute('**/api/skills');print('PASS F1 actual old GET cannot replace confirmed save',flush=True)
  if case in ['duplicate','all']:
   open_matrix();create_draft('M365');page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('alert').wait_for()
   name=page.get_by_label('Nom de la compétence',exact=True)
   assert not name.is_disabled(),'definitive duplicate 409 must remain editable'
   page.get_by_role('button',name='Recharger la matrice',exact=True).click();page.wait_for_timeout(250)
   assert name.input_value()=='M365','reload discarded rejected draft'
   name.fill('Correction du doublon');page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('status').filter(has_text='Compétence enregistrée et relue.').wait_for()
   assert any(s['name']=='Correction du doublon' for s in context.request.get('http://127.0.0.1:4100/api/skills').json()['competences'])
   print('PASS F3 correct duplicate and save; refresh preserves draft',flush=True)
  if case in ['navigation','all']:
   open_matrix();create_draft('Draft must survive navigation');dialogs=[]
   def dismiss(d):dialogs.append(d.message);d.dismiss()
   page.on('dialog',dismiss)
   page.get_by_role('button',name='Profils et clients',exact=True).click()
   assert dialogs,'parent tab did not ask before discarding'
   assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='Draft must survive navigation'
   sidebar=page.locator('aside a[href]').first
   target=sidebar.get_attribute('href');sidebar.click();page.wait_for_timeout(150)
   assert page.url.endswith('/primes');assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='Draft must survive navigation'
   page.get_by_role('button',name='Se déconnecter',exact=True).click();assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='Draft must survive navigation'
   assert len(dialogs)>=3
   # Router POP transition with a real previous route.
   page.remove_listener('dialog',dismiss);page.get_by_role('button',name='Annuler',exact=True).click()
   sidebar.click();page.wait_for_timeout(150);page.locator('aside a[href="/primes"]').click();page.get_by_role('button',name='Maîtrise de polyvalence',exact=True).click();page.get_by_role('table',name='Matrice de polyvalence').wait_for();create_draft('History protected')
   page.on('dialog',dismiss);before=len(dialogs);page.evaluate('history.back()');page.wait_for_timeout(200)
   assert len(dialogs)==before+1,'router POP must confirm'
   assert page.url.endswith('/primes');assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='History protected'
   before=len(dialogs);page.evaluate('setTimeout(()=>location.reload(),0)');page.wait_for_timeout(200)
   assert len(dialogs)==before+1,'reload must confirm';assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='History protected'
   page.remove_listener('dialog',dismiss)
   page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='Profils et clients',exact=True).click();page.get_by_role('button',name='Maîtrise de polyvalence',exact=True).click();page.get_by_role('table',name='Matrice de polyvalence').wait_for()
   print('PASS F2 tabs, shell route, logout and history veto; explicit abandon allowed',flush=True)
  if case in ['recovery','all']:
   open_matrix();create_draft('Réponse perdue');sent=[]
   def lost_response(route):
    sent.append((route.request.url,route.request.post_data_json));response=route.fetch();assert response.status==200;route.abort()
   page.route('**/api/skills/competences/*',lost_response)
   page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('alert').wait_for()
   assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='Réponse perdue'
   assert page.get_by_label('Nom de la compétence',exact=True).is_disabled()
   page.get_by_role('button',name='Profils et clients',exact=True).click();assert page.get_by_label('Nom de la compétence',exact=True).is_visible()
   page.unroute('**/api/skills/competences/*');page.get_by_role('button',name='Recharger la matrice',exact=True).click();page.get_by_role('status').filter(has_text='Compétence enregistrée et relue.').wait_for()
   assert page.get_by_label('Nom de la compétence',exact=True).count()==0
   data=context.request.get('http://127.0.0.1:4100/api/skills').json();assert len([s for s in data['competences'] if s['name']=='Réponse perdue'])==1
   create_draft('Saisie conservée');page.route('**/api/skills/competences/*',lost_response)
   page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('alert').wait_for();page.unroute('**/api/skills/competences/*')
   url=sent[-1][0];r=context.request.put(url,data={'name':'Modification concurrente','archived':False,'expectedVersion':1});assert r.status==200
   page.get_by_role('button',name='Recharger la matrice',exact=True).click();page.get_by_text('Version partagée 2',exact=False).wait_for()
   assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='Saisie conservée'
   assert page.get_by_role('button',name='Enregistrer la compétence',exact=True).is_disabled()
   page.once('dialog',lambda d:d.dismiss());page.get_by_role('button',name='Reprendre sur la version actuelle',exact=True).click();assert page.get_by_role('button',name='Enregistrer la compétence',exact=True).is_disabled()
   page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='Reprendre sur la version actuelle',exact=True).click();page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('status').filter(has_text='Compétence enregistrée et relue.').wait_for()
   data=context.request.get('http://127.0.0.1:4100/api/skills').json();assert next(s for s in data['competences'] if s['id']==url.rsplit('/',1)[-1])['version']==3
   create_draft('Nouvel essai même identité');attempts=[]
   def dropped_request(route):attempts.append(route.request.url);route.abort()
   page.route('**/api/skills/competences/*',dropped_request);page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('alert').wait_for();page.unroute('**/api/skills/competences/*')
   page.get_by_role('button',name='Recharger la matrice',exact=True).click();page.get_by_role('status').filter(has_text='Écriture non confirmée').wait_for()
   assert page.get_by_label('Nom de la compétence',exact=True).input_value()=='Nouvel essai même identité'
   def real_retry(route):attempts.append(route.request.url);route.continue_()
   page.route('**/api/skills/competences/*',real_retry);page.get_by_role('button',name='Enregistrer la compétence',exact=True).click();page.get_by_role('status').filter(has_text='Compétence enregistrée et relue.').wait_for();page.unroute('**/api/skills/competences/*')
   assert len(attempts)==2 and attempts[0]==attempts[1]
   print('PASS uncertain commit reconciliation, explicit concurrent-version conflict, retry same id',flush=True)
  page.screenshot(path='/evidence/repair-ui-final.png',full_page=True)
  browser.close()
finally:server.terminate();server.wait();log.close()
