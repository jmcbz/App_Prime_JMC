import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outfile = new URL('./.workstation-audit-test.mjs', import.meta.url).pathname;
let generateWorkstationAuditScript, generateWorkstationAuditLauncher;
try {
  await build({ entryPoints: [new URL('./workstationAuditScript.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm' });
  ({ generateWorkstationAuditScript, generateWorkstationAuditLauncher } = await import(outfile));
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
    const source = `function Wait-AuditClose {}\n$ReportDir='${dir}'\n$env:COMPUTERNAME='PC-TEST'\n$env:USERNAME='test'\n$Config=@{ClientName='BZ';Apps=@('Google Chrome',' google  chrome ','TeamViewer')}\n$script:Resultats=New-Object System.Collections.ArrayList\nfunction Add-Check {param($Categorie,$Nom,$Etat,$Detail) [void]$script:Resultats.Add([pscustomobject]@{Categorie=$Categorie;Nom=$Nom;Etat=$Etat;Detail=$Detail})}\n${appMocks('Google Chrome')}\n${apps}\n${report}`;
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
    const source = `function Wait-AuditClose {}\n$ReportDir='${dir}'\n$env:COMPUTERNAME='PC-<svg onload=alert(1)>'\n$env:USERNAME='<b>intrus</b>'\n$Config=@{ClientName='${payload}'}\n$Resultats=@([pscustomobject]@{Categorie='${payload}';Nom='${payload}';Etat='ECHEC';Detail='${payload}'})\n${report.replace("'Signature courriel conforme (pas de virgule sans titre)'", `'${payload}'`)}`;
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

// Full-script runtime: Windows-only APIs are inert fixtures; pipelines/HTML/I/O/exit are real.
const fullWindowsStubs = String.raw`param([string]$ScriptPath,[string]$ReportDir,[string]$Scenario='healthy',[switch]$UseDefaultReportDir,[switch]$PauseAudit,[switch]$NoPauseAudit)
$ErrorActionPreference='Stop'
$env:COMPUTERNAME='PC-FIXTURE'
$env:USERNAME='Usager é <fixture>'
$env:SystemDrive='C:'
$global:FixtureScenario=$Scenario
function Get-ItemProperty {
 [CmdletBinding()]param([string]$Path)
 if ($Path -like '*CurrentVersion' -and $Path -like '*Windows NT*') { return [pscustomobject]@{EditionID='Professional';ProductName='Windows';DisplayVersion='24H2';CurrentBuildNumber='26100'} }
 if ($Path -like '*EnrollmentFixture*') {return [pscustomobject]@{ProviderID='MS DM Server'}}
 if ($Path -like '*AppFixture*') {return [pscustomobject]@{DisplayName='Google Chrome';DisplayVersion='123'}}
 if ($Path -like '*FileExts*') {return [pscustomobject]@{ProgId='Acrobat.Document.DC'}}
 if ($Path -like '*UrlAssociations*') {return [pscustomobject]@{ProgId='ChromeHTML'}}
 if ($Path -like '*LanguageResources') {return [pscustomobject]@{UILanguage=3084}}
 throw "Unstubbed registry access: $Path"
}
function Get-ChildItem {
 [CmdletBinding()]param([string]$Path)
 if ($Path -like '*Enrollments') {return [pscustomobject]@{PSPath='HKLM:\EnrollmentFixture'}}
 if ($Path -like '*Uninstall') {return [pscustomobject]@{PSPath='HKLM:\AppFixture'}}
 throw "Unstubbed inventory: $Path"
}
function Test-Path {
 [CmdletBinding(DefaultParameterSetName='Path')]param([Parameter(ParameterSetName='Path',Position=0)][string[]]$Path,[Parameter(ParameterSetName='Literal')][string[]]$LiteralPath,[string]$PathType)
 if ($Path -match '^HK(LM|CU):') {return $true}
 return Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
function Get-LocalUser { [CmdletBinding()]param($Name) return [pscustomobject]@{SID='S-1-5-21-fixture';Enabled=$true} }
function Get-LocalGroupMember { [CmdletBinding()]param($SID) return [pscustomobject]@{SID='S-1-5-21-fixture'} }
function Get-AppxPackage { [CmdletBinding()]param() return @() }
function Get-CimInstance { [CmdletBinding()]param($ClassName) return [pscustomobject]@{Manufacturer='Lenovo'} }
function Get-WinUserLanguageList { return [pscustomobject]@{LanguageTag='fr-CA';InputMethodTips=@('0C0C:00001009')} }
function Get-Printer { [CmdletBinding()]param() return [pscustomobject]@{Name='TOSHIBA.[ modèle é'} }
function Get-BitLockerVolume { [CmdletBinding()]param($MountPoint) return [pscustomobject]@{ProtectionStatus='On';EncryptionPercentage=100} }
function dsregcmd { $global:LASTEXITCODE=0; 'AzureAdJoined : YES' }
function Start-Process { param($FilePath) Write-Host "FIXTURE_BROWSER_SUPPRESSED $FilePath" }
function New-Object {
 [CmdletBinding()]param([Parameter(Position=0)][string]$TypeName,[string]$ComObject)
 if (-not $ComObject) { return ,(Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName) }
 if ($ComObject -ne 'Microsoft.Update.Session') {throw "Unstubbed COM: $ComObject"}
 if ($global:FixtureScenario -eq 'com-create-throws') {throw 'Fixture COM creation unavailable'}
 $searcher=[pscustomobject]@{}
 $searcher | Add-Member ScriptMethod Search {
  param($Criteria)
  if ($global:FixtureScenario -eq 'com-search-throws') {throw 'Fixture COM search unavailable'}
  $updates=[System.Collections.ArrayList]::new()
  if ($global:FixtureScenario -eq 'one-update') {[void]$updates.Add([pscustomobject]@{Title='Correctif é unique'})}
  if ($global:FixtureScenario -eq 'two-updates') {1..2 | ForEach-Object {[void]$updates.Add([pscustomobject]@{Title="Correctif $_"})}}
  return [pscustomobject]@{Updates=$updates}
 }
 $global:FixtureSearcher=$searcher
 $session=[pscustomobject]@{}
 $session | Add-Member ScriptMethod CreateUpdateSearcher {return $global:FixtureSearcher}
 return $session
}
function Read-Host { param($Prompt) Write-Host "FIXTURE_READ_HOST"; if ($global:FixtureScenario -eq 'pause-unavailable') {throw 'Fixture console unavailable'}; return "" }
if ($Scenario -eq 'pause-unavailable') {$WarningPreference='Stop'}
$invoke=@{}
if ($PauseAudit) {$invoke.Pause=$true}
if ($NoPauseAudit) {$invoke.NoPause=$true}
if (-not $UseDefaultReportDir) {$invoke.ReportDir=$ReportDir}
try {
 & $ScriptPath @invoke
 exit $LASTEXITCODE
} catch {
 [pscustomobject]@{ExceptionType=$_.Exception.GetType().FullName;FullyQualifiedErrorId=$_.FullyQualifiedErrorId;Message=$_.Exception.Message;Position=$_.InvocationInfo.PositionMessage;ScriptStackTrace=$_.ScriptStackTrace} | ConvertTo-Json -Depth 4 | Out-File -LiteralPath (Join-Path (Split-Path $ScriptPath) 'fatal-error.json') -Encoding utf8
 throw
}
`;
const fullSteps = [
  ['bz-1-1', 'Installer / valider Windows 11 Pro'],
  ['bz-1-4', 'Ajouter le compte admin local bzinc'],
  ['bz-2-1', 'Mises à jour Windows'],
  ['bz-2-7', "Installer l'imprimante du client"],
  ['bz-3-3', 'Clavier : retirer les autres langues, garder FR/CA'],
].map(([id,title]) => ({id,title,note:''}));
const fullOptions = {...options,clientName:"L'Intendant é <img src=x onerror=alert(1)>",printerName:'TOSHIBA.[',apps:['Google Chrome'],procedure:{name:"Procédure é d'Intendant",source:'Modèle client',sections:[{title:'Préparation',steps:fullSteps}]}};
function fullRun({dirMode='valid',pause=false,scenario='healthy',opts=fullOptions,transform=x=>x}={}, verify) {
  const dir=mkdtempSync(join(process.env.TMPDIR || tmpdir(),'audit-full-'));
  try {
    const file=join(dir,'audit.ps1'),wrapper=join(dir,'windows-stubs.ps1');
    const script=transform(generateWorkstationAuditScript(opts));
    writeFileSync(file,'\ufeff'+script);writeFileSync(wrapper,fullWindowsStubs);
    parse(script);
    let reportDir=dir;
    if(dirMode==='blank')reportDir='';
    if(dirMode==='whitespace')reportDir=' \t ';
    if(dirMode==='missing')reportDir=join(dir,'absent','Bureau');
    if(dirMode==='onedrive') {reportDir=join(dir,'OneDrive - Client é','Bureau');mkdirSync(reportDir,{recursive:true});}
    // The isolation runner mounts /opt/pwsh read-only. No OS configuration is written.
    if(dirMode==='readonly')reportDir='/opt/pwsh';
    const args=['-NoProfile','-NonInteractive','-File',wrapper,'-ScriptPath',file,'-Scenario',scenario];
    if(dirMode==='default')args.push('-UseDefaultReportDir');else args.push('-ReportDir',reportDir);
    if(pause===true || pause==='both')args.push('-PauseAudit');
    if(pause===false || pause==='both')args.push('-NoPauseAudit');
    const run=spawnSync('pwsh',args,{encoding:'utf8',timeout:20000});
    const target=dirMode==='default'?dir:reportDir;
    const reports=target && existsSync(target)?readdirSync(target).filter(x=>/^AuditPoste_PC-FIXTURE_.*\.html$/.test(x)):[];
    const html=reports.length?readFileSync(join(target,reports[0]),'utf8'):'';
    verify({...run,html,reports,reportDir:target,dir,fatal:existsSync(join(dir,'fatal-error.json'))});
  } finally {rmSync(dir,{recursive:true,force:true});}
}

test('full script pauses by default before a complete exit', () => {
  fullRun({pause:'default'}, run => {
    assert.equal(run.status,0,run.stderr);
    assert.equal((run.stdout.match(/FIXTURE_READ_HOST/g)||[]).length,1);
    assert.ok(run.stdout.indexOf('Rapport :') < run.stdout.indexOf('FIXTURE_READ_HOST'));
  });
});

for (const stage of ['early','late','after-report']) test(`full script unexpected ${stage} failure shows diagnostics and pauses before technical exit`, () => {
  const marker = stage==='early' ? '# Configuration client' : stage==='late' ? '# ============================ RAPPORT' : 'try { Start-Process -FilePath $fichier } catch {}';
  const transform = s => s.replace(marker, `throw 'Fixture unexpected ${stage}' # SOURCE_SECRET_NOT_FOR_DIAGNOSTICS\n${marker}`);
  fullRun({pause:'default',transform}, run => {
    assert.equal(run.status,2,run.stderr);
    assert.equal((run.stdout.match(/FIXTURE_READ_HOST/g)||[]).length,1);
    const text=run.stdout+run.stderr;
    assert.match(text,new RegExp(`Erreur inattendue.*Fixture unexpected ${stage}`,'s'));
    assert.match(text,/audit\.ps1.*(?:ligne|line)/s);
    assert.match(text,/Pile PowerShell/);
    assert.doesNotMatch(text,/SOURCE_SECRET_NOT_FOR_DIAGNOSTICS/);
    assert.equal(run.fatal,false);
    assert.equal(run.reports.length,stage==='after-report'?1:0);
    assert.equal(run.stdout.includes('Rapport :'),stage==='after-report');
  });
});

test('full script controls explicit blank report path with technical exit 2', () => {
  fullRun({dirMode:'blank'}, run => {
    assert.equal(run.status,2,run.stderr);
    assert.match(run.stderr,/Écriture du rapport impossible.*ReportDir/s);
    assert.equal(run.fatal,false);assert.equal(run.reports.length,0);
    assert.doesNotMatch(run.stdout,/FIXTURE_READ_HOST/);
  });
});

test('full script falls back to existing script directory when default Desktop is empty', () => {
  fullRun({dirMode:'default'}, run => {
    assert.equal(run.status,0,run.stderr);assert.equal(run.reports.length,1);
    assert.match(run.stdout,/Bureau indisponible.*dossier du script/s);
    assert.ok(run.stdout.includes(run.dir));assert.equal(run.fatal,false);
  });
});

// Explicit PS5.1 scalar Count emulation on PS7, not a Windows 5.1 execution.
for (const [label,scenario,opts,color,verdict] of [
  ['failure','one-update',fullOptions,'#B4234A','NON CONFORME'],
  ['verification','healthy',{...fullOptions,procedure:{...fullOptions.procedure,sections:[{title:'Préparation',steps:[...fullSteps,{id:'manual',title:'Vérification visuelle',note:''}]}]}},'#B45309','NON VALIDÉ'],
]) test(`full script PS5.1 Count emulation keeps single ${label} KPI at 1`, () => {
  fullRun({scenario,opts,transform:script=>script.replace('Categorie = $Categorie; Nom = $Nom; Etat = $Etat; Detail = $Detail','Count = $null; Categorie = $Categorie; Nom = $Nom; Etat = $Etat; Detail = $Detail')}, run => {
    assert.equal(run.status,1,run.stderr);assert.equal(run.reports.length,1);
    assert.ok(run.html.includes(`<b style='color:${color}'>1</b>`),'single-result KPI must be 1, not blank');
    assert.ok(run.html.includes(`<div class='verdict'>${verdict}`));
  });
});

for (const [label,params,exit] of [
  ['complete',{},0],
  ['incomplete',{opts:{...fullOptions,procedure:{...fullOptions.procedure,sections:[{title:'Validation',steps:[{id:'manual',title:'Validation humaine',note:''}]}]}}},1],
  ['technical failure',{dirMode:'blank'},2],
]) test(`full script explicit Pause reads once before ${label} exit`, () => {
  fullRun({...params,pause:true}, run => {
    assert.equal(run.status,exit,run.stderr);
    assert.equal((run.stdout.match(/FIXTURE_READ_HOST/g)||[]).length,1);
    if(exit!==2)assert.ok(run.stdout.indexOf('Rapport :') < run.stdout.indexOf('FIXTURE_READ_HOST'));
    if(exit===1)assert.match(run.stdout,/Audit non validé/);
  });
});

test('CMD launcher keeps an external Enter pause and exact neighbor path without argument injection (static)', () => {
  const cmd=generateWorkstationAuditLauncher('audit poste-L-Intendant.ps1');
  assert.match(cmd,/^@echo off\r\nsetlocal EnableExtensions DisableDelayedExpansion\r\n/);
  assert.match(cmd,/set "ERRORLEVEL="\r\n/); // Do not let an inherited variable shadow CMD's exit-code pseudo-variable.
  assert.match(cmd,/set "auditScript=%~dp0audit poste-L-Intendant\.ps1"/);
  assert.match(cmd,/if not exist "%auditScript%" goto missingScript/);
  assert.match(cmd,/if not exist "%auditPowerShell%" goto missingPowerShell/);
  assert.match(cmd,/"%auditPowerShell%" -NoProfile -ExecutionPolicy Bypass -File "%auditScript%" -NoPause\r\nset "auditExit=%errorlevel%"/);
  assert.match(cmd,/set \/p "auditClose=.*Entree.*" <CON/);
  assert.match(cmd,/endlocal & exit \/b %auditExit%\r\n$/);
  assert.doesNotMatch(cmd,/%\*|\bcall\b|-NoExit|-Command|Set-ExecutionPolicy/i);
  assert.doesNotMatch(cmd,/(?<!\r)\n|[^\x00-\x7f]/);
  assert.equal(cmd.split('set /p').length-1,1);
  for (const name of ['../x.ps1','C:\\x.ps1','bad%PATH%.ps1','bad!VAR!.ps1','bad&calc.ps1','bad\".ps1','bad\r\ncalc.ps1',"d'Intendant.ps1",'é.ps1','x.cmd']) {
    assert.throws(()=>generateWorkstationAuditLauncher(name),/nom/i,name);
  }
});

test('full script NoPause wins over legacy Pause and never reads input', () => {
  fullRun({pause:'both'}, run=>{
    assert.equal(run.status,0,run.stderr);assert.doesNotMatch(run.stdout,/FIXTURE_READ_HOST/);
  });
});
for (const [label,params,expected] of [
  ['complete',{},0],
  ['incomplete',{scenario:'one-update'},1],
  ['report error',{dirMode:'blank'},2],
  ['unexpected early',{transform:s=>s.replace('# Configuration client', "throw 'NoPause early failure'\n# Configuration client")},2],
  ['unexpected late',{transform:s=>s.replace('# ============================ RAPPORT', "throw 'NoPause late failure'\n# ============================ RAPPORT")},2],
]) {
  test(`full script default pause preserves ${label} exit ${expected}`,()=>{
    fullRun({...params,pause:'default'},run=>{
      assert.equal(run.status,expected,run.stderr);assert.equal((run.stdout.match(/FIXTURE_READ_HOST/g)||[]).length,1);
    });
  });
  test(`full script explicit NoPause preserves ${label} exit ${expected} without input`,()=>{
    fullRun({...params,pause:false},run=>{
      assert.equal(run.status,expected,run.stderr);assert.doesNotMatch(run.stdout,/FIXTURE_READ_HOST/);
    });
  });
  test(`full script unavailable pause preserves ${label} exit ${expected}`,()=>{
    fullRun({...params,scenario:'pause-unavailable',pause:'default',...(label==='incomplete'?{opts:{...fullOptions,procedure:{name:'Manuel',sections:[{title:'Validation',steps:[{id:'manual',title:'Vérifier manuellement',note:''}]}]}}}:{})},run=>{
      assert.equal(run.status,expected,run.stderr);assert.equal((run.stdout.match(/FIXTURE_READ_HOST/g)||[]).length,1);
      assert.match(run.stdout,/Pause indisponible/);assert.equal(run.fatal,false);
    });
  });
}

test('launch help supports dynamic downloaded filenames and documents cwd, reports, Pause and exit contract', () => {
  for(const opts of [options,fullOptions]) {
    const script=generateWorkstationAuditScript(opts);
    assert.ok(script.includes('-File "<chemin exact du fichier téléchargé>" -Pause'));
    assert.doesNotMatch(script,/Audit-MontagePoste\.ps1|audit-poste-windows\.ps1/);
    assert.match(script,/dossier courant/);assert.match(script,/dossier du script/);
    assert.match(script,/0 = conforme.*1 = audit non validé.*2 = erreur technique/s);
    assert.match(script,/attend Entrée par défaut/);assert.match(script,/-NoPause désactive toute saisie/);
    assert.match(script,/lanceur CMD voisin/);
  }
});

for(const dirMode of ['whitespace','missing','readonly']) test(`full script ${dirMode} report path fails under controlled technical exit`, () => {
  fullRun({dirMode},run=>{
    assert.equal(run.status,2,run.stderr);assert.match(run.stderr,/Écriture du rapport impossible/);
    assert.equal(run.reports.length,0);assert.equal(run.fatal,false);
    assert.doesNotMatch(run.stdout,/FIXTURE_READ_HOST/);
  });
});
for(const [scenario,exit] of [['healthy',0],['one-update',1],['two-updates',1],['com-create-throws',1],['com-search-throws',1]]) test(`full script Windows Update ${scenario} writes consistent report without waiting`, () => {
  fullRun({scenario,dirMode:'onedrive'},run=>{
    assert.equal(run.status,exit,run.stderr);assert.equal(run.stderr,'');assert.equal(run.reports.length,1);
    assert.doesNotMatch(run.stdout,/FIXTURE_READ_HOST/);
    assert.match(run.html,/Client : L&#39;Intendant &#233; &lt;img/);
    assert.match(run.html,/Procédure : Proc&#233;dure &#233; d&#39;Intendant/);
    assert.doesNotMatch(run.html,/<img src=x|\uFFFD/);
    const states=[...run.html.matchAll(/<span class='bdg'[^>]*>([^<]*)<\/span>/g)].map(m=>m[1]);
    assert.equal(states.length,7);
    for(const [text,color,label] of [['OK','#16763D','Conformes'],['ÉCHEC','#B4234A','Échecs'],['À VÉRIFIER','#B45309','À vérifier']]) {
      const count=states.filter(x=>x.includes(text)).length;
      assert.ok(run.html.includes(`<b style='color:${color}'>${count}</b><span>${label}</span>`),label);
    }
    assert.equal(run.html.includes("<div class='verdict'>CONFORME</div>"),exit===0);
  });
});
test('full script PS5.1 Count emulation keeps single OK and multiple verification KPIs', () => {
  const opts={...fullOptions,adminLocal:'',keyboards:[],printerName:'',apps:[],procedure:{name:'Manuel',sections:[{title:'Validation',steps:[{id:'manual',title:'Validation humaine',note:''}]}]}};
  fullRun({opts,transform:s=>s.replace('Categorie = $Categorie; Nom = $Nom; Etat = $Etat; Detail = $Detail','Count = $null; Categorie = $Categorie; Nom = $Nom; Etat = $Etat; Detail = $Detail')},run=>{
    assert.equal(run.status,1,run.stderr);assert.match(run.html,/<b style='color:#16763D'>1<\/b>/);
    assert.match(run.html,/<b style='color:#B4234A'>0<\/b>/);
    assert.match(run.html,/<b style='color:#B45309'>5<\/b>/);
  });
});
