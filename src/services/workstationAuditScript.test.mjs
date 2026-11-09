import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outfile = new URL('./.workstation-audit-test.mjs', import.meta.url).pathname;
let generateWorkstationAuditScript;
try {
  await build({ entryPoints: [new URL('./workstationAuditScript.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm' });
  ({ generateWorkstationAuditScript } = await import(outfile));
} finally { try { unlinkSync(outfile); } catch {} }

const options = {clientName:'BZ',computerPrefix:'PC-',adminLocal:'bzinc',keyboards:['fr-CA'],printerName:'',apps:['Microsoft 365 / Office','Adobe Acrobat','Google Chrome','TeamViewer','Lenovo Vantage']};
function parse(script) {
  const path = `${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/audit-${process.pid}.ps1`;
  writeFileSync(path, '\ufeff' + script, 'utf8');
  try {
    let result;
    try { result = execFileSync('pwsh', ['-NoProfile','-NonInteractive','-Command', '$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile($env:AUDIT_PARSE_PATH,[ref]$t,[ref]$e)>$null; $e | ForEach-Object { Write-Output $_.Message }; if($e.Count -gt 0){exit 1}'], {encoding:'utf8', env:{...process.env,AUDIT_PARSE_PATH:path}}); }
    catch (error) { throw new Error(`PowerShell parse failed: ${error.stdout} ${error.stderr}`); }
    assert.equal(result.trim(),'');
  } finally { unlinkSync(path); }
}

function probe(section, setup, extraOptions = options) {
  const script = generateWorkstationAuditScript(extraOptions);
  const start = script.indexOf(section);
  assert.ok(start >= 0, section);
  const end = script.indexOf('\n# --- ', start + section.length);
  const fragment = script.slice(start, end < 0 ? undefined : end);
  const literal = x => `'${x.replaceAll("'", "''")}'`;
  const source = `$ErrorActionPreference='Stop'\n$Config=@{ComputerPrefix=${literal(extraOptions.computerPrefix)};Apps=@(${extraOptions.apps.map(literal).join(',')});Keyboards=@(${extraOptions.keyboards.map(literal).join(',')})}\n$script:Resultats=New-Object System.Collections.ArrayList\nfunction Add-Check {param($Categorie,$Nom,$Etat,$Detail) [void]$script:Resultats.Add([pscustomobject]@{Categorie=$Categorie;Nom=$Nom;Etat=$Etat;Detail=$Detail})}\n${setup}\n${fragment}\n$script:Resultats | ConvertTo-Json -Depth 5 -Compress`;
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'audit-probe-'));
  try {
    const file = join(dir, 'probe.ps1');
    writeFileSync(file, '\ufeff' + source);
    const result = spawnSync('pwsh', ['-NoProfile','-NonInteractive','-File',file], {encoding:'utf8'});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  } finally { rmSync(dir, {recursive:true, force:true}); }
}

const windowsVersion = (edition, build = 22000) => `function Get-ItemProperty { return [pscustomobject]@{EditionID='${edition}';ProductName='Windows';DisplayVersion='23H2';CurrentBuildNumber='${build}'} }`;
const dsregStatus = output => `function dsregcmd { $global:LASTEXITCODE=0; @'
${output}
'@ }`;

const appMocks = displayName => `
function Test-Path { return $true }
function Get-ChildItem { return @([pscustomobject]@{PSPath='fake'}) }
function Get-ItemProperty { return [pscustomobject]@{DisplayName='${displayName}';DisplayVersion='1.0'} }
function Get-AppxPackage { return @() }
function Get-CimInstance { return [pscustomobject]@{Manufacturer='Lenovo'} }
`;

const updateMocks = (updates, searchBody = 'return [pscustomobject]@{Updates=$script:MockUpdates}') => `
$script:MockUpdates = ${updates}
function Write-Host { param($Object, $ForegroundColor) }
function New-Object {
  param($TypeName, $ComObject)
  $searcher = [pscustomobject]@{}
  $searcher | Add-Member -MemberType ScriptMethod -Name Search -Value { param($criteria) ${searchBody} }
  $script:MockSearcher = $searcher
  $session = [pscustomobject]@{}
  $session | Add-Member -MemberType ScriptMethod -Name CreateUpdateSearcher -Value { return $script:MockSearcher }
  return $session
}
`;

test('null Windows Update inventory requires verification rather than claiming no updates', () => {
  const row = probe('# --- 6. Windows Update', updateMocks('$null'));
  assert.equal(row.Nom, 'Windows Update à jour');
  assert.equal(row.Etat, 'A VERIFIER');
});

test('valid empty Windows Update collection reports no pending updates', () => {
  const row = probe('# --- 6. Windows Update', updateMocks('[System.Collections.ArrayList]::new()'));
  assert.equal(row.Etat, 'OK');
  assert.match(row.Detail, /Aucune mise à jour/);
});

test('Windows Update collection with pending software reports failure', () => {
  const row = probe('# --- 6. Windows Update', updateMocks('([System.Collections.ArrayList]::new()) + @([pscustomobject]@{Title="Correctif urgent"})'));
  assert.equal(row.Etat, 'ECHEC');
  assert.match(row.Detail, /1 en attente.*Correctif urgent/);
});

test('Windows Update search exception requires verification', () => {
  const row = probe('# --- 6. Windows Update', updateMocks('$null', "throw 'Recherche indisponible'"));
  assert.equal(row.Etat, 'A VERIFIER');
});

test('missing or invalid Windows Update Count requires verification', () => {
  for (const updates of ['[pscustomobject]@{}', '[pscustomobject]@{Count=$null}', '[pscustomobject]@{Count="0"}', '[pscustomobject]@{Count=-1}']) {
    const row = probe('# --- 6. Windows Update', updateMocks(updates));
    assert.equal(row.Etat, 'A VERIFIER', updates);
  }
});

test('NotProfessional Windows 11 edition cannot claim Pro OK', () => {
  const row = probe('# --- 1. Système', windowsVersion('NotProfessional'));
  assert.equal(row.Nom, 'Windows 11 Pro');
  assert.equal(row.Etat, 'ECHEC');
});

test('only exact Professional editions on Windows 11 claim Pro OK', () => {
  for (const edition of ['Professional', 'ProfessionalN']) {
    assert.equal(probe('# --- 1. Système', windowsVersion(edition)).Etat, 'OK', edition);
    assert.equal(probe('# --- 1. Système', windowsVersion(edition, 19045)).Etat, 'ECHEC', `${edition} on Windows 10`);
  }
  for (const edition of ['Pro', 'ProfessionalEducation', 'ProfessionalWorkstation', 'NotProfessional', 'Enterprise', '']) {
    assert.equal(probe('# --- 1. Système', windowsVersion(edition)).Etat, 'ECHEC', edition);
  }
});

test('PreviousAzureAdJoined YES cannot override actual AzureAdJoined NO', () => {
  const row = probe('# --- 3. Jonction Entra ID', dsregStatus('AzureAdJoined : NO\nPreviousAzureAdJoined : YES'));
  assert.equal(row.Nom, 'Joint à Entra ID (Azure AD)');
  assert.equal(row.Etat, 'ECHEC');
});

test('Entra join accepts only one exact AzureAdJoined YES line', () => {
  const row = probe('# --- 3. Jonction Entra ID', dsregStatus('Device State\n    AzureAdJoined : YES\nPreviousAzureAdJoined : NO'));
  assert.equal(row.Etat, 'OK');
});

test('ambiguous, missing or malformed AzureAdJoined lines require verification', () => {
  for (const output of [
    'AzureAdJoined : YES\nAzureAdJoined : NO',
    'AzureAdJoined : YES\nAzureAdJoined : YES',
    'PreviousAzureAdJoined : YES',
    'AzureAdJoined : MAYBE\nPreviousAzureAdJoined : YES',
    'AzureAdJoined : YES extra',
  ]) {
    const row = probe('# --- 3. Jonction Entra ID', dsregStatus(output));
    assert.equal(row.Etat, 'A VERIFIER', output);
  }
});

test('empty computer prefix cannot mark an unrelated computer name OK', () => {
  const result = probe('# --- 2. Nom du poste', "$env:COMPUTERNAME='WRONG-NAME'", {...options, computerPrefix:''});
  assert.equal(result.Nom, 'Nom du poste conforme');
  assert.equal(result.Etat, 'A VERIFIER');
});

test('whitespace-only computer prefix requires manual name verification', () => {
  const result = probe('# --- 2. Nom du poste', "$env:COMPUTERNAME='WRONG-NAME'", {...options, computerPrefix:' \t '});
  assert.equal(result.Etat, 'A VERIFIER');
});

test('nonempty computer prefix stays anchored and regex metacharacters are literal', () => {
  const opts = {...options, computerPrefix:'PC.['};
  assert.equal(probe('# --- 2. Nom du poste', "$env:COMPUTERNAME='PC.[-01'", opts).Etat, 'OK');
  assert.equal(probe('# --- 2. Nom du poste', "$env:COMPUTERNAME='XPC.[-01'", opts).Etat, 'ECHEC');
  assert.equal(probe('# --- 2. Nom du poste', "$env:COMPUTERNAME='PCX[-01'", opts).Etat, 'ECHEC');
});

test('Chrome Remote Desktop Host is not Google Chrome', () => {
  const result = probe('# --- 7. Applications requises', appMocks('Google Chrome Remote Desktop Host'), {...options, apps:['Google Chrome']});
  assert.equal(result.Etat, 'ECHEC');
});

test('Office Click-to-Run component is not Office', () => {
  const result = probe('# --- 7. Applications requises', appMocks('Microsoft Office Click-to-Run (SxS)'), {...options, apps:['Microsoft 365 / Office']});
  assert.equal(result.Etat, 'ECHEC');
});

test('FR-CA language with US keyboard tip is not FR-CA keyboard only', () => {
  const result = probe('# --- 8. Clavier', "function Get-WinUserLanguageList { return @([pscustomobject]@{LanguageTag='fr-CA';InputMethodTips=@('0C0C:00000409')}) }");
  assert.equal(result.Etat, 'ECHEC');
});

test('FR-CA language with Canadian French tip is OK', () => {
  const result = probe('# --- 8. Clavier', "function Get-WinUserLanguageList { return @([pscustomobject]@{LanguageTag='fr-CA';InputMethodTips=@('0C0C:00001009')}) }");
  assert.equal(result.Etat, 'OK');
});

test('missing input method tips cannot claim OK', () => {
  const result = probe('# --- 8. Clavier', "function Get-WinUserLanguageList { return @([pscustomobject]@{LanguageTag='fr-CA';InputMethodTips=@()}) }");
  assert.equal(result.Etat, 'A VERIFIER');
});

test('Canadian French plus US input methods cannot claim keyboard-only OK', () => {
  const result = probe('# --- 8. Clavier', "function Get-WinUserLanguageList { return @([pscustomobject]@{LanguageTag='fr-CA';InputMethodTips=@('0C0C:00001009','0C0C:00000409')}) }");
  assert.equal(result.Etat, 'ECHEC');
});

test('unexpected language remains an ECHEC even with Canadian French tip', () => {
  const result = probe('# --- 8. Clavier', "function Get-WinUserLanguageList { return @([pscustomobject]@{LanguageTag='en-US';InputMethodTips=@('0C0C:00001009')}) }");
  assert.equal(result.Etat, 'ECHEC');
});

test('default audit contains local technical probes, manual checklist and conservative verdict', () => {
  const script = generateWorkstationAuditScript(options);
  parse(script);
  for (const name of ['Windows 11 Pro','dsregcmd','MS DM Server','Get-LocalGroupMember','Microsoft.Update.Session','Get-WinUserLanguageList','Get-Printer','Get-BitLockerVolume','Office en français','PDF par défaut','Navigateur par défaut','Authenticator','Signature du technicien']) assert.ok(script.includes(name), name);
  assert.match(script,/\$echec\s*-eq\s*0\s*-and\s*\$verif\s*-eq\s*0\s*-and\s*\$Manuels\.Count\s*-eq\s*0/);
  assert.match(script,/NON CONFORME|NON VALIDÉ/);
});

test('all client fields remain inert PowerShell literals even with hostile punctuation and substitution', () => {
  const hostile = "O'Hare`$(Write-Host HACK);<img src=x onerror=alert(1)>\r\n#";
  const script = generateWorkstationAuditScript({clientName:hostile, computerPrefix:hostile+'[.*', adminLocal:hostile, keyboards:[hostile], printerName:hostile, apps:[hostile]});
  parse(script);
  const path = `${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/audit-ast-${process.pid}.ps1`;
  writeFileSync(path, '\ufeff'+script, 'utf8');
  try {
    const commands = execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command', '$t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile($env:AUDIT_PARSE_PATH,[ref]$t,[ref]$e);$a.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.Extent.Text -match "HACK"},$true).Count'],{encoding:'utf8',env:{...process.env,AUDIT_PARSE_PATH:path}});
    assert.equal(commands.trim(),'0');
  } finally { unlinkSync(path); }
  assert.ok(script.includes("O''Hare`$(Write-Host HACK)"));
  assert.ok(!script.includes('$Config.ClientName = "'));
  assert.match(script,/\[regex\]::Escape\(\$Config\.ComputerPrefix\)/);
  assert.match(script,/\[regex\]::Escape\(\$Config\.PrinterName\)/);
  assert.match(script,/HtmlEnc \$Config\.ClientName/);
  assert.match(script,/HtmlEnc \$r\.Categorie/);
  assert.match(script,/HtmlEnc \$_/);
});

test('installed Adobe Acrobat 64-bit confirms PDF-reader capability, not a helper', () => {
  const opts = {...options, apps:['Adobe Acrobat']};
  assert.equal(probe('# --- 7. Applications requises', appMocks('Adobe Acrobat (64-bit)'), opts).Etat, 'OK');
  assert.equal(probe('# --- 7. Applications requises', appMocks('Adobe Acrobat (64-bit) Update'), opts).Etat, 'ECHEC');
});

test('approved Office suite alias is detected by exact display name', () => {
  const result = probe('# --- 7. Applications requises', appMocks('Microsoft 365 Apps for enterprise'), {...options, apps:['Microsoft 365 / Office']});
  assert.equal(result.Etat, 'OK');
});

test('Office language-suffixed suite alias is detected without accepting a component', () => {
  const result = probe('# --- 7. Applications requises', appMocks('Microsoft 365 Apps for enterprise - fr-ca'), {...options, apps:['Microsoft 365 / Office']});
  assert.equal(result.Etat, 'OK');
});

test('Lenovo Store package alias is detected but a similarly named package is not', () => {
  const mock = name => `function Test-Path { return $false }\nfunction Get-AppxPackage { return [pscustomobject]@{Name='${name}';Version='1.0'} }\nfunction Get-CimInstance { return [pscustomobject]@{Manufacturer='Lenovo'} }`;
  assert.equal(probe('# --- 7. Applications requises', mock('E0469640.LenovoVantage'), {...options, apps:['Lenovo Vantage']}).Etat, 'OK');
  assert.equal(probe('# --- 7. Applications requises', mock('E0469640.LenovoVantage.Helper'), {...options, apps:['Lenovo Vantage']}).Etat, 'ECHEC');
});

test('hostile custom app name is compared literally rather than interpreted as regex', () => {
  const result = probe('# --- 7. Applications requises', appMocks('Adobe Acrobat'), {...options, apps:['Adobe.*']});
  assert.equal(result.Etat, 'ECHEC');
});

test('configured app aliases differing only in case or whitespace yield one counted row, distinct apps remain', () => {
  const rows = probe('# --- 7. Applications requises', appMocks('Google Chrome'), {...options, apps:[' Google   Chrome ', 'google chrome', 'GOOGLE CHROME', 'TeamViewer']});
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['Google Chrome','OK'],['TeamViewer','ECHEC']]);
  assert.equal(rows.filter(({Etat}) => Etat === 'OK').length, 1);
});

test('a later Lenovo manufacturer lookup failure does not duplicate earlier Chrome OK', () => {
  const setup = `function Test-Path { return $true }
function Get-ChildItem { return @([pscustomobject]@{PSPath='fake'}) }
function Get-ItemProperty { return [pscustomobject]@{DisplayName='Google Chrome';DisplayVersion='1.0'} }
function Get-AppxPackage { return @() }
function Get-CimInstance { throw 'manufacturer unavailable' }`;
  const rows = probe('# --- 7. Applications requises', setup, {...options, apps:['Google Chrome','Lenovo Vantage']});
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['Google Chrome','OK'],['Lenovo Vantage','A VERIFIER']]);
});

test('an incomplete application inventory never claims Chrome OK', () => {
  const setup = `function Test-Path { return $true }
function Get-ChildItem { return @([pscustomobject]@{PSPath='first'},[pscustomobject]@{PSPath='broken'}) }
function Get-ItemProperty { param($Path) if ($Path -eq 'broken') { throw 'inventory incomplete' } return [pscustomobject]@{DisplayName='Google Chrome';DisplayVersion='1.0'} }
function Get-AppxPackage { return @() }`;
  const rows = probe('# --- 7. Applications requises', setup, {...options, apps:['Google Chrome','Lenovo Vantage']});
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['Google Chrome','A VERIFIER'],['Lenovo Vantage','A VERIFIER']]);
});

test('HTTP Chrome with HTTPS Edge is not a Chrome default browser, without duplicating rows', () => {
  const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='Acrobat.Document.DC'} } if ($Path -like '*\\https\\*') { return [pscustomobject]@{ProgId='MSEdgeHTM'} } return [pscustomobject]@{ProgId='ChromeHTML'} }`;
  const rows = probe('# --- 9. Applications par défaut', setup);
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','OK'],['Navigateur par défaut = Chrome','ECHEC']]);
  assert.match(rows[1].Detail, /https.*MSEdgeHTM/i);
});

test('both HTTP and HTTPS Chrome associations yield one browser OK independently of Adobe PDF', () => {
  const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='MSEdgePDF'} } return [pscustomobject]@{ProgId='ChromeHTML'} }`;
  const rows = probe('# --- 9. Applications par défaut', setup);
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','ECHEC'],['Navigateur par défaut = Chrome','OK']]);
  assert.match(rows[1].Detail, /HTTP : ChromeHTML ; HTTPS : ChromeHTML/);
});

test('unavailable or undefined protocol association needs verification, not a browser OK', () => {
  for (const protocol of ['http', 'https']) {
    for (const response of ["throw 'registry inaccessible'", 'return $null', "return [pscustomobject]@{ProgId=$null}"]) {
      const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='AcroExch.Document.DC'} } if ($Path -like '*\\${protocol}\\*') { ${response} } return [pscustomobject]@{ProgId='ChromeHTML'} }`;
      const rows = probe('# --- 9. Applications par défaut', setup);
      assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','OK'],['Navigateur par défaut = Chrome','A VERIFIER']], `${protocol}: ${response}`);
    }
  }
});

test('impostor Chrome ProgIds on either protocol cannot claim browser OK', () => {
  for (const [http, https] of [['ChromeHTML.Impostor','ChromeHTML'],['ChromeHTML','NotChromeBrowser'],['MSEdgeHTM','ChromeHTML']]) {
    const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='Acrobat.Document.DC'} } if ($Path -like '*\\https\\*') { return [pscustomobject]@{ProgId='${https}'} } return [pscustomobject]@{ProgId='${http}'} }`;
    const rows = probe('# --- 9. Applications par défaut', setup);
    assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','OK'],['Navigateur par défaut = Chrome','ECHEC']], `${http}/${https}`);
  }
});

test('default-app ProgIds with Adobe or Chrome only as substrings cannot claim OK', () => {
  const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='NotAdobeReader'} } return [pscustomobject]@{ProgId='NotChromeBrowser'} }`;
  const rows = probe('# --- 9. Applications par défaut', setup);
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','ECHEC'],['Navigateur par défaut = Chrome','ECHEC']]);
});

test('known Adobe Classic Acrobat and Reader ProgIDs are accepted, unknown names remain rejected', () => {
  for (const id of ['Acrobat.Document.2015','Acrobat.Document.2017','Acrobat.Document.2020','Acrobat.Document.DC','AcroExch.Document.2015','AcroExch.Document.2017','AcroExch.Document.2020','AcroExch.Document.DC']) {
    const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='${id}'} } return [pscustomobject]@{ProgId='ChromeHTML'} }`;
    const rows = probe('# --- 9. Applications par défaut', setup);
    assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','OK'],['Navigateur par défaut = Chrome','OK']], id);
  }
  for (const id of ['NotAdobeReader','Acrobat.Document.2021','Acrobat.Document.2020.Helper']) {
    const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='${id}'} } return [pscustomobject]@{ProgId='ChromeHTML'} }`;
    const rows = probe('# --- 9. Applications par défaut', setup);
    assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','ECHEC'],['Navigateur par défaut = Chrome','OK']], id);
  }
});

test('known Adobe Acrobat and Chrome ProgIds remain OK', () => {
  const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='Acrobat.Document.DC'} } return [pscustomobject]@{ProgId='ChromeHTML'} }`;
  const rows = probe('# --- 9. Applications par défaut', setup);
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','OK'],['Navigateur par défaut = Chrome','OK']]);
});

test('known AcroExch.Document.DC ProgId remains OK while ChromeHTML suffix is not assumed trusted', () => {
  const setup = `function Get-ItemProperty { param($Path) if ($Path -like '*FileExts*') { return [pscustomobject]@{ProgId='AcroExch.Document.DC'} } return [pscustomobject]@{ProgId='ChromeHTML.Impostor'} }`;
  const rows = probe('# --- 9. Applications par défaut', setup);
  assert.deepEqual(rows.map(({Nom, Etat}) => [Nom, Etat]), [['PDF par défaut = Adobe','OK'],['Navigateur par défaut = Chrome','ECHEC']]);
});

test('duplicate configured app cannot inflate HTML KPI or create an extra report row', () => {
  const opts = {...options, apps:['Google Chrome',' google  chrome ','TeamViewer']};
  const script = generateWorkstationAuditScript(opts);
  const apps = script.slice(script.indexOf('# --- 7. Applications requises'), script.indexOf('# --- 8. Clavier'));
  const report = script.slice(script.indexOf('# --- Points manuels'));
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'audit-count-'));
  try {
    const file = join(dir, 'report.ps1');
    const source = `$ReportDir='${dir}'\n$env:COMPUTERNAME='PC-TEST'\n$env:USERNAME='test'\n$Config=@{ClientName='BZ';Apps=@('Google Chrome',' google  chrome ','TeamViewer')}\n$script:Resultats=New-Object System.Collections.ArrayList\nfunction Add-Check {param($Categorie,$Nom,$Etat,$Detail) [void]$script:Resultats.Add([pscustomobject]@{Categorie=$Categorie;Nom=$Nom;Etat=$Etat;Detail=$Detail})}\n${appMocks('Google Chrome')}\n${apps}\n${report}`;
    writeFileSync(file, '\ufeff' + source);
    const result = spawnSync('pwsh', ['-NoProfile','-NonInteractive','-File',file], {encoding:'utf8'});
    assert.equal(result.status, 1, result.stderr); // Manual checklist keeps the audit non-conformant.
    const htmlFile = readdirSync(dir).find(x => x.endsWith('.html'));
    assert.ok(htmlFile, result.stderr);
    const html = readFileSync(join(dir, htmlFile), 'utf8');
    assert.match(html, /<b style='color:#16763D'>1<\/b><span>Conformes<\/span>/);
    assert.match(html, /<b style='color:#B4234A'>1<\/b><span>Échecs<\/span>/);
    assert.equal((html.match(/<td>Google Chrome<\/td>/g) || []).length, 1);
    assert.equal((html.match(/<td>TeamViewer<\/td>/g) || []).length, 1);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('script-side report encodes dynamic client, user, computer, check and manual HTML', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const script = generateWorkstationAuditScript({...options, clientName:payload});
  const report = script.slice(script.indexOf('# --- Points manuels'));
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'audit-html-'));
  try {
    const file = join(dir, 'report.ps1');
    const source = `$ReportDir='${dir}'\n$env:COMPUTERNAME='PC-<svg onload=alert(1)>'\n$env:USERNAME='<b>intrus</b>'\n$Config=@{ClientName='${payload}'}\n$Resultats=@([pscustomobject]@{Categorie='${payload}';Nom='${payload}';Etat='ECHEC';Detail='${payload}'})\n${report.replace("'Signature courriel conforme (pas de virgule sans titre)'", `'${payload}'`)}`;
    writeFileSync(file, '\ufeff' + source);
    const result = spawnSync('pwsh', ['-NoProfile','-NonInteractive','-File',file], {encoding:'utf8'});
    assert.equal(result.status, 1, result.stderr);
    const htmlFile = readdirSync(dir).find(x => x.endsWith('.html'));
    assert.ok(htmlFile, result.stderr);
    const html = readFileSync(join(dir, htmlFile), 'utf8');
    assert.ok(!html.includes(payload));
    assert.ok(!html.includes('<svg onload='));
    assert.ok(!html.includes('<b>intrus</b>'));
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html,/&lt;svg onload=alert\(1\)&gt;/);
    assert.match(html,/&lt;b&gt;intrus&lt;\/b&gt;/);
    assert.match(html,/NON CONFORME/);
    assert.match(html,/Points manuels/);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('application inventory treats missing uninstall hives as empty rather than invalidating all apps', () => {
  const script=generateWorkstationAuditScript(options);
  assert.match(script,/Test-Path -Path \$k/);
  assert.match(script,/Get-ChildItem \$k -ErrorAction Stop/);
  assert.match(script,/Get-ItemProperty \$entry\.PSPath -ErrorAction Stop/);
});

test('placeholder-like client text cannot overwrite another configuration field', () => {
  const script = generateWorkstationAuditScript({...options, clientName:'__PREFIX__ __ADMIN__ __APPS__', computerPrefix:'SAFETY-', adminLocal:'manager'});
  parse(script);
  assert.match(script,/ClientName = '__PREFIX__ __ADMIN__ __APPS__'/);
  assert.match(script,/ComputerPrefix = 'SAFETY-'/);
  assert.match(script,/AdminLocal = 'manager'/);
});

test('unavailable probes are A VERIFIER and report cannot claim conformity with manual tasks outstanding', () => {
  const script=generateWorkstationAuditScript(options);
  assert.match(script,/dsregcmd.*-ErrorAction Stop|Get-Command dsregcmd/);
  assert.match(script,/Get-ChildItem.*Enrollments.*-ErrorAction Stop/);
  assert.match(script,/Get-LocalUser.*-ErrorAction Stop/);
  assert.match(script,/Get-Printer.*-ErrorAction Stop/);
  assert.match(script,/Get-ItemProperty.*UserChoice.*-ErrorAction Stop/);
  assert.match(script,/Manuels\.Count.*A VERIFIER|Manuels\.Count.*NON VALIDÉ/s);
  assert.match(script,/HtmlEnc \$env:COMPUTERNAME/);
  assert.match(script,/HtmlEnc \$env:USERNAME/);
  assert.match(script,/Join-Path \$ReportDir/);
});

const selected = steps => ({...options, procedure:{name:'Procédure Client', sections:[{title:'Préparation',steps}]}});
test('client-controlled newline block markers remain data in procedure scripts', () => {
  const marker = 'ACME\n# --- 2. forged\nWrite-Host PWN';
  const script = generateWorkstationAuditScript({
    ...selected([{id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:''}]),
    clientName:marker, adminLocal:marker, printerName:marker,
    apps:[marker], keyboards:[marker], computerPrefix:marker,
  });
  parse(script);
  assert.match(script,/ClientName = 'ACME\n# --- 2\. forged\nWrite-Host PWN'/);
  assert.match(script,/# --- 2\. Nom du poste/);
  assert.match(script,/# --- 7\. Applications requises/);
  assert.match(script,/# --- 10\. Imprimante/);
});
test('procedure names, notes, comments and section data do not undergo placeholder substitution', () => {
  const data = "__CLIENT__\n# --- 7. forged\nWrite-Host PWN";
  const script = generateWorkstationAuditScript({
    ...options, clientName:'Actual client',
    procedure:{name:data,source:data,sections:[{title:data,steps:[
      {id:'custom',title:data,note:data,commentaire:data},
      {id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:data,commentaire:data},
    ]}]},
  });
  parse(script);
  assert.match(script,/ClientName = 'Actual client'/);
  assert.match(script,/\$ProcedureName = '__CLIENT__\n# --- 7\. forged\nWrite-Host PWN'/);
  assert.match(script,/\$ProcedureSource = '__CLIENT__\n# --- 7\. forged\nWrite-Host PWN'/);
  assert.ok(script.includes(`'${data} ; ${data}'`));
  assert.ok(script.includes(`'${data}' 'A VERIFIER'`));
});
test('selected known BZ step runs its mapped probe plus independent configured client checks', () => {
  const script=generateWorkstationAuditScript(selected([{id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:'Valider la version'}]));
  parse(script);
  assert.match(script,/CurrentBuildNumber/);
  assert.doesNotMatch(script,/dsregcmd|Microsoft.Update.Session|Get-BitLockerVolume/);
  assert.match(script,/Get-Printer/); // Client printer evidence is supplemental, not a procedure verdict.
  assert.match(script,/Get-AppxPackage|Contrôles techniques supplémentaires/);
  assert.match(script,/Procédure Client|Valider la version/);
});
test('custom and renamed standard steps are manual, never inferred as automatic', () => {
  const script=generateWorkstationAuditScript(selected([{id:'custom',title:'Windows 11 Pro',note:'Contrôle humain'},{id:'bz-1-1',title:'Windows 11 Pro',note:''}]));
  parse(script);
  assert.doesNotMatch(script,/CurrentBuildNumber|Microsoft.Update.Session/);
  assert.match(script,/A VERIFIER|Contrôle humain/);
});
test('N/A dossier steps are omitted and hostile notes and comments stay literal', () => {
  const hostile="O'Hare`$(Write-Host HACK)<img src=x onerror=alert(1)>";
  const steps=[
    {id:'bz-2-1',title:'Mises à jour Windows',note:'',etat:'na',commentaire:'NE-PAS-INCLURE'},
    {id:'custom',title:hostile,note:hostile,etat:'todo',commentaire:hostile},
  ];
  const script=generateWorkstationAuditScript({...selected(steps), procedure:{name:hostile,sections:[{title:'Préparation',steps}]}});
  parse(script);
  assert.doesNotMatch(script,/Microsoft.Update.Session|NE-PAS-INCLURE/);
  assert.match(script,/O''Hare`\$\(Write-Host HACK\)/);
  assert.match(script,/HtmlEnc \$r\.Detail/);
});
test('procedure report encodes selected section, step, note, comment and client; no unrelated rows', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const script = generateWorkstationAuditScript({...options, clientName:hostile, procedure:{name:hostile, source:hostile, sections:[
    {title:hostile,steps:[{id:'custom',title:hostile,note:hostile,commentaire:hostile,etat:'fait'}]},
    {title:'Hors périmètre',steps:[{id:'bz-2-1',title:'Mises à jour Windows',note:'',etat:'na',commentaire:'NE-PAS-INCLURE'}]},
  ]}});
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-procedure-'));
  try {
    const file=join(dir,'procedure.ps1');writeFileSync(file,'\ufeff'+script);
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
    assert.ok(!html.includes(hostile));
    assert.ok(!html.includes('NE-PAS-INCLURE'));
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html,/NON VALIDÉ|NON CONFORME/);
    assert.equal((html.match(/<span class='bdg'/g)||[]).length,10);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('known selected probe produces exactly one named row with note and comment in HTML', () => {
  const script=generateWorkstationAuditScript(selected([{id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:'Voir billet',commentaire:'Observation terrain'}]));
  const mocked=script.replace("# --- 1. Système d'exploitation", `${windowsVersion('Professional')}\n# --- 1. Système d'exploitation`);
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-known-'));
  try {
    const file=join(dir,'known.ps1');writeFileSync(file,'\ufeff'+mocked);
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
    assert.equal((html.match(/<span class='bdg'/g)||[]).length,10);
    assert.match(html,/<td>Installer \/ valider Windows 11 Pro<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*À VÉRIFIER/);
    assert.match(html,/Voir billet.*Observation terrain/);
    assert.match(html,/À VÉRIFIER/);
    assert.doesNotMatch(html,/<div class='verdict'>CONFORME<\/div>/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('procedure mode reports configured prefix and apps as independent technical checks', () => {
  const opts={...selected([{id:'custom',title:'Installer et tester le poste',note:''}]),computerPrefix:'PC.[',apps:['Google Chrome','TeamViewer']};
  const script=generateWorkstationAuditScript(opts);
  parse(script);
  assert.match(script,/\[regex\]::Escape\(\$Config\.ComputerPrefix\)/);
  assert.match(script,/Get-AppxPackage/);
  const mocked=script.replace('# --- 2. Nom du poste', "$env:COMPUTERNAME='PC.[-01'\n# --- 2. Nom du poste")
    .replace('# --- 7. Applications requises', `${appMocks('Google Chrome')}\n# --- 7. Applications requises`);
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-extra-'));
  try {
    const file=join(dir,'extra.ps1');writeFileSync(file,'\ufeff'+mocked);
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
    assert.match(html,/<td>Nom du poste conforme<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*OK/);
    assert.match(html,/<td>Google Chrome<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*OK/);
    assert.match(html,/<td>TeamViewer<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*ÉCHEC/);
    assert.match(html,/<td>Installer et tester le poste<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*À VÉRIFIER/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('empty applicable scope cannot yield a conforming report', () => {
  const script=generateWorkstationAuditScript({...options,procedure:{name:'Exclusions',sections:[{title:'Validation',steps:[{id:'x',title:'Ignore',note:'',etat:'na'}]}]}});
  assert.match(script,/A VERIFIER|NON VALIDÉ/);
  assert.match(script,/Aucune étape applicable/);
});

test('server-valid multiline notes and up to 300 steps are accepted as literal data', () => {
  const sections=Array.from({length:30},(_,i)=>({title:`Section ${i}`,steps:Array.from({length:10},(_,j)=>({id:`s${i}-${j}`,title:`Étape ${j}`,note:'Première ligne\nDeuxième ligne'}))}));
  const script=generateWorkstationAuditScript({...options,procedure:{name:'Complet',sections}});
  parse(script);
  assert.match(script,/Deuxième ligne/);
});

test('client printer step without an explicit printer name stays manual rather than trusting any printer', () => {
  const script=generateWorkstationAuditScript(selected([{id:'bz-2-7',title:"Installer l'imprimante du client",note:''}]));
  assert.match(script,/if \(\[string\]::IsNullOrWhiteSpace\(\$Config.PrinterName\)\)/);
  assert.match(script,/Motif de l''imprimante du client non défini/);
  assert.match(script,/Validation manuelle requise/);
});

test('standard printer note and dossier-only comment remain unverified despite successful narrow probes', () => {
  const cases = [
    {step:{id:'bz-2-7',title:"Installer l'imprimante du client",note:'Tester une page sur place'},printerName:'TOSHIBA.[',mock:"function Get-Printer { return @([pscustomobject]@{Name='TOSHIBA.[ modèle'}) }",title:"Installer l'imprimante du client"},
    {step:{id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:'',commentaire:'Vérifier BitLocker et test usager',etat:'fait'},printerName:'',mock:windowsVersion('Professional'),title:'Installer / valider Windows 11 Pro'},
  ];
  for (const {step,printerName,mock,title} of cases) {
    const script=generateWorkstationAuditScript({...selected([step]),printerName,computerPrefix:'',apps:[]});
    const marker=step.id === 'bz-2-7' ? '# --- 10. Imprimante' : "# --- 1. Système d'exploitation";
    const mocked=script.replace(marker,`${mock}\n${marker}`);
    parse(mocked);
    const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-manual-'));
    try {
      const file=join(dir,'manual.ps1');writeFileSync(file,'\ufeff'+mocked);
      const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
      assert.equal(result.status,1,result.stderr);
      assert.doesNotMatch(result.stdout,/\[OK\s*\].*(?:Windows 11 Pro|Imprimante installée)/);
      const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
      assert.match(html,new RegExp(`<td>${title.replaceAll("'",'&#39;')}</td><td[^>]*><span class='bdg'[^>]*>[^<]*À VÉRIFIER`));
      assert.match(html,/Validation manuelle de la note requise/);
      assert.doesNotMatch(html,/<div class='verdict'>CONFORME<\/div>/);
    } finally {rmSync(dir,{recursive:true,force:true});}
  }
});

test('missing admin, keyboard and printer settings cannot turn successful OS, prefix and app checks green', () => {
  const script=generateWorkstationAuditScript({...selected([{id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:''}]),computerPrefix:'PC-',apps:['Google Chrome'],adminLocal:'',keyboards:[],printerName:''});
  const mocked=script.replace("# --- 1. Système d'exploitation",`${windowsVersion('Professional')}\n# --- 1. Système d'exploitation`)
    .replace('# --- 2. Nom du poste',"$env:COMPUTERNAME='PC-01'\n# --- 2. Nom du poste")
    .replace('# --- 7. Applications requises',`${appMocks('Google Chrome')}\n# --- 7. Applications requises`);
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-missing-client-'));
  try {
    const file=join(dir,'missing.ps1');writeFileSync(file,'\ufeff'+mocked);
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
    assert.equal(result.status,1,`${result.stdout}\n${result.stderr}`);
    const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
    assert.match(html,/<td>Installer \/ valider Windows 11 Pro<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*OK/);
    assert.match(html,/<td>Nom du poste conforme<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*OK/);
    assert.match(html,/<td>Google Chrome<\/td><td[^>]*><span class='bdg'[^>]*>[^<]*OK/);
    for (const name of ['Compte administrateur local','Clavier attendu','Imprimante du client']) {
      assert.match(html,new RegExp(`<td>${name}</td><td[^>]*><span class='bdg'[^>]*>[^<]*À VÉRIFIER`));
    }
    assert.match(html,/<div class='verdict'>NON VALIDÉ/);
    assert.doesNotMatch(html,/<div class='verdict'>CONFORME<\/div>/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('empty prefix and app configuration never produces a conforming procedure report', () => {
  const script=generateWorkstationAuditScript({...selected([{id:'bz-1-1',title:'Installer / valider Windows 11 Pro',note:''}]),computerPrefix:'',apps:[]});
  const mocked=script.replace("# --- 1. Système d'exploitation",`${windowsVersion('Professional')}\n# --- 1. Système d'exploitation`);
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-empty-'));
  try {
    const file=join(dir,'empty.ps1');writeFileSync(file,'\ufeff'+mocked);
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
    assert.match(html,/Pr&#233;fixe du client non d&#233;fini/);
    assert.match(html,/Aucune application configur&#233;e/);
    assert.doesNotMatch(html,/<div class='verdict'>CONFORME<\/div>/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('mapped admin, keyboard and literal printer probes execute once without supplementary duplicate rows', () => {
  const steps=[
    {id:'bz-1-4',title:'Ajouter le compte admin local bzinc',note:''},
    {id:'bz-3-3',title:'Clavier : retirer les autres langues, garder FR/CA',note:''},
    {id:'bz-2-7',title:"Installer l'imprimante du client",note:''},
  ];
  const script=generateWorkstationAuditScript({...selected(steps),computerPrefix:'',apps:[],printerName:'TOSHIBA.['});
  const mock=`function Get-LocalUser { return [pscustomobject]@{SID='S-1-5-21-42';Enabled=$true} }
function Get-LocalGroupMember { return @([pscustomobject]@{SID='S-1-5-21-42'}) }
function Get-WinUserLanguageList { return @([pscustomobject]@{LanguageTag='fr-CA';InputMethodTips=@('0C0C:00001009')}) }
function Get-Printer { return @([pscustomobject]@{Name='TOSHIBA.[ modèle'},[pscustomobject]@{Name='TOSHIBAXX autre'}) }`;
  const mocked=script.replace('# Contrôle standard bz-1-4',`${mock}\n# Contrôle standard bz-1-4`);
  parse(mocked);
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-mapped-'));
  try {
    const file=join(dir,'mapped.ps1');writeFileSync(file,'\ufeff'+mocked);
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',file,'-ReportDir',dir],{encoding:'utf8'});
    assert.equal(result.status,1,`${result.stdout}\n${result.stderr}`);
    const html=readFileSync(join(dir,readdirSync(dir).find(x=>x.endsWith('.html'))),'utf8');
    for (const step of steps) {
      const escaped=step.title.replaceAll("'",'&#39;');
      assert.equal(html.split(`<td>${escaped}</td>`).length-1,1,step.title);
      assert.match(html,new RegExp(`<td>${escaped.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}</td><td[^>]*><span class='bdg'[^>]*>[^<]*OK`));
    }
    assert.doesNotMatch(html,/<td>(?:Compte local « bzinc »|Clavier FR-CA uniquement|Imprimante installée)<\/td>/);
    assert.match(html,/TOSHIBA\.\[ mod&#232;le/);
    assert.doesNotMatch(html,/TOSHIBAXX autre/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('client printer motif keeps the BZ vendor-match semantics without regex injection', () => {
  const script=generateWorkstationAuditScript({...selected([{id:'bz-2-7',title:"Installer l'imprimante du client",note:''}]),printerName:'TOSHIBA'});
  parse(script);
  assert.match(script,/Get-Printer/);
  assert.match(script,/\$_.Name -match \[regex\]::Escape\(\$Config.PrinterName\)/);
});

test('malformed or oversized procedure data fails closed rather than generating a partial audit', () => {
  for (const sections of [null, [{}], [{title:'x',steps:[{id:'x',title:'x',note:3}]}],
    [{title:'x',steps:[{id:'x',title:'x',note:'x'.repeat(4001)}]}],
    [{title:'x',steps:Array.from({length:301},(_,i)=>({id:String(i),title:'x',note:''}))}]]) {
    assert.throws(()=>generateWorkstationAuditScript({...options,procedure:{name:'X',sections}}), /procédure/i);
  }
});
