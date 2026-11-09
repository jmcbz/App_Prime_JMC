/** Génère un audit local en lecture seule compatible Windows PowerShell 5.1. */
export type WorkstationAuditOptions = {
  clientName: string;
  computerPrefix: string;
  adminLocal: string;
  keyboards: string[];
  printerName: string;
  apps: string[];
  /** Opt-in: pass the opened dossier snapshot, otherwise the selected client's template. */
  procedure?: { name: string; sections: AuditProcedureSection[]; source?: string };
};

export type AuditProcedureStep = { id: string; title: string; note: string; etat?: 'todo' | 'fait' | 'na'; commentaire?: string };
export type AuditProcedureSection = { title: string; steps: AuditProcedureStep[] };

export const DEFAULT_WORKSTATION_AUDIT_OPTIONS: WorkstationAuditOptions = {
  clientName: 'BZ', computerPrefix: 'PC-', adminLocal: 'bzinc',
  keyboards: ['fr-CA'], printerName: '',
  apps: ['Microsoft 365 / Office', 'Adobe Acrobat', 'Google Chrome', 'TeamViewer', 'Lenovo Vantage'],
};

function psLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
function psArray(values: string[]): string {
  return values.map(psLiteral).join(', ');
}

const SCRIPT_TEMPLATE = String.raw`<#
.SYNOPSIS
    Audit de montage de poste — audit client
.DESCRIPTION
    Vérifie automatiquement les points techniques de la procédure de montage de poste
    et produit un rapport HTML (+ résumé console). À lancer À LA FIN du montage,
    dans la session de l'USAGER (certains contrôles sont par profil : clavier, apps par défaut).
.UTILISATION
    PowerShell (idéalement en admin) :
      powershell.exe -ExecutionPolicy Bypass -File .\Audit-MontagePoste.ps1
    Rapport déposé sur le Bureau : AuditPoste_<NOMPC>_<date>.html
.NOTES
    Compatible Windows PowerShell 5.1 et PowerShell 7. v1 — BZ.
#>
param(
    [string]$ReportDir = [Environment]::GetFolderPath('Desktop')
)

# Configuration client : valeurs de données littérales, jamais évaluées comme code.
$Config = @{
    ClientName = __CLIENT__
    ComputerPrefix = __PREFIX__
    AdminLocal = __ADMIN__
    Keyboards = @(__KEYBOARDS__)
    PrinterName = __PRINTER__
    Apps = @(__APPS__)
}

$ErrorActionPreference = 'Stop'
$script:Resultats = New-Object System.Collections.ArrayList

function Add-Check {
    param([string]$Categorie,[string]$Nom,[string]$Etat,[string]$Detail)
    if ($script:ManualStepRequiresVerification -and $Etat -eq 'OK') {
        $Etat = 'A VERIFIER'
        $Detail += ' — Validation manuelle de la note requise'
    }
    [void]$script:Resultats.Add([pscustomobject]@{
        Categorie = $Categorie; Nom = $Nom; Etat = $Etat; Detail = $Detail })
    $c = switch ($Etat) { 'OK' {'Green'} 'ECHEC' {'Red'} default {'Yellow'} }
    Write-Host ("[{0,-9}] {1} — {2}" -f $Etat, $Nom, $Detail) -ForegroundColor $c
}

Write-Host ""
Write-Host "=== AUDIT DE MONTAGE DE POSTE — audit client ===" -ForegroundColor Cyan
Write-Host ("Poste : {0} · Usager : {1} · {2}" -f $env:COMPUTERNAME, $env:USERNAME, (Get-Date -Format 'yyyy-MM-dd HH:mm')) -ForegroundColor Cyan
Write-Host ""

# --- 1. Système d'exploitation -------------------------------------------
try {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $edition = $cv.EditionID; $produit = $cv.ProductName
    $version = if ($cv.DisplayVersion) { $cv.DisplayVersion } else { $cv.ReleaseId }
    $build = [int]$cv.CurrentBuildNumber
    $estWin11 = $build -ge 22000
    $estPro = $edition -in @('Professional', 'ProfessionalN')
    $libelle = "{0}{1} {2} (build {3})" -f ($(if($estWin11){'Windows 11 '}else{'Windows 10 '})), $edition, $version, $build
    if ($estWin11 -and $estPro) { Add-Check 'Système' 'Windows 11 Pro' 'OK' $libelle }
    elseif ($estPro)            { Add-Check 'Système' 'Windows 11 Pro' 'ECHEC' "$libelle — pas Windows 11" }
    else                        { Add-Check 'Système' 'Windows 11 Pro' 'ECHEC' "$libelle — édition non Pro" }
} catch { Add-Check 'Système' 'Windows 11 Pro' 'A VERIFIER' "Lecture impossible : $($_.Exception.Message)" }

# --- 2. Nom du poste -------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Config.ComputerPrefix)) {
    Add-Check 'Système' 'Nom du poste conforme' 'A VERIFIER' 'Préfixe du client non défini : valider le nom du poste manuellement'
} elseif ($env:COMPUTERNAME -match ('^' + [regex]::Escape($Config.ComputerPrefix))) {
    Add-Check 'Système' 'Nom du poste conforme' 'OK' $env:COMPUTERNAME
} else {
    Add-Check 'Système' 'Nom du poste conforme' 'ECHEC' ("{0} ne respecte pas le motif « {1} »" -f $env:COMPUTERNAME, $Config.ComputerPrefix)
}

# --- 3. Jonction Entra ID / Autopilot -------------------------------------
try {
    if (-not (Get-Command dsregcmd -ErrorAction SilentlyContinue)) { throw 'dsregcmd indisponible' }
    $dsreg = (& dsregcmd /status 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dsreg)) { throw 'dsregcmd sans résultat fiable' }
    $joinLines = [regex]::Matches($dsreg, '(?m)^[ \t]*AzureAdJoined[ \t]*:[ \t]*([^\r\n]*)\r?$')
    if ($joinLines.Count -ne 1) { throw 'État de jonction absent ou ambigu' }
    $joinState = $joinLines[0].Groups[1].Value.Trim()
    if ($joinState -ceq 'YES') { Add-Check 'Identité' 'Joint à Entra ID (Azure AD)' 'OK' 'AzureAdJoined : YES' }
    elseif ($joinState -ceq 'NO') { Add-Check 'Identité' 'Joint à Entra ID (Azure AD)' 'ECHEC' 'AzureAdJoined : NO' }
    else { throw 'État de jonction inconnu' }
} catch { Add-Check 'Identité' 'Joint à Entra ID (Azure AD)' 'A VERIFIER' 'dsregcmd indisponible ou résultat illisible' }

# --- 4. Inscription Intune (MDM) -------------------------------------------
try {
    $enrollments = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Enrollments' -ErrorAction Stop)
    $mdm = $false
    foreach ($enrollment in $enrollments) {
        $p = Get-ItemProperty $enrollment.PSPath -ErrorAction Stop
        if ($p.ProviderID -eq 'MS DM Server') { $mdm = $true }
    }
    if ($mdm) { Add-Check 'Identité' 'Inscrit dans Intune (MDM)' 'OK' 'Inscription « MS DM Server » présente' }
    else { Add-Check 'Identité' 'Inscrit dans Intune (MDM)' 'ECHEC' 'Aucune inscription MDM trouvée' }
} catch { Add-Check 'Identité' 'Inscrit dans Intune (MDM)' 'A VERIFIER' 'Lecture des inscriptions impossible' }

# --- 5. Compte admin local -------------------------------------------------
try {
    $u = Get-LocalUser -Name $Config.AdminLocal -ErrorAction Stop
    $grp = Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop
    $estAdmin = @($grp | Where-Object { $_.SID -eq $u.SID }).Count -gt 0
    if ($u.Enabled -and $estAdmin) { Add-Check 'Identité' ("Compte local « {0} »" -f $Config.AdminLocal) 'OK' 'Présent, actif, membre Administrateurs' }
    elseif (-not $u.Enabled) { Add-Check 'Identité' ("Compte local « {0} »" -f $Config.AdminLocal) 'ECHEC' 'Compte désactivé' }
    else { Add-Check 'Identité' ("Compte local « {0} »" -f $Config.AdminLocal) 'ECHEC' 'Compte non membre Administrateurs' }
} catch { Add-Check 'Identité' ("Compte local « {0} »" -f $Config.AdminLocal) 'A VERIFIER' 'Compte ou appartenance admin non vérifiable' }

# --- 6. Windows Update ------------------------------------------------------
try {
    Write-Host "  (recherche de mises à jour en attente — peut prendre 1 à 2 minutes...)" -ForegroundColor DarkGray
    $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
    $pend = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0").Updates
    if ($null -eq $pend -or $null -eq $pend.PSObject.Properties['Count']) { throw 'Inventaire Windows Update absent' }
    $pendingCount = $pend.Count
    if ($null -eq $pendingCount -or $pendingCount -isnot [int] -or $pendingCount -lt 0) { throw 'Nombre de mises à jour illisible' }
    if ($pendingCount -eq 0) { Add-Check 'Mises à jour' 'Windows Update à jour' 'OK' 'Aucune mise à jour logicielle en attente' }
    else {
        $noms = ($pend | Select-Object -First 3 | ForEach-Object { $_.Title }) -join ' ; '
        Add-Check 'Mises à jour' 'Windows Update à jour' 'ECHEC' ("{0} en attente : {1}..." -f $pendingCount, $noms)
    }
} catch { Add-Check 'Mises à jour' 'Windows Update à jour' 'A VERIFIER' 'Recherche impossible (service WU ?)' }

# --- 7. Applications requises ----------------------------------------------
$cles = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
          'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
          'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
$inventoryAvailable = $true
try {
    $installees = @()
    foreach ($k in $cles) {
        if (Test-Path -Path $k) {
            foreach ($entry in @(Get-ChildItem $k -ErrorAction Stop)) {
                $installees += @(Get-ItemProperty $entry.PSPath -ErrorAction Stop)
            }
        }
    }
    $appx = @(Get-AppxPackage -ErrorAction Stop)
} catch { $inventoryAvailable = $false }
$seenApps = @{} # Hashtable keys compare case-insensitively in Windows PowerShell 5.1 and PS 7.
foreach ($configuredApp in $Config.Apps) {
    $app = [regex]::Replace(([string]$configuredApp).Trim(), '\s+', ' ')
    if (-not $app -or $seenApps.ContainsKey($app)) { continue }
    $seenApps[$app] = $true
    if (-not $inventoryAvailable) {
        Add-Check 'Applications' $app 'A VERIFIER' 'Inventaire applicatif indisponible ou incomplet'
        continue
    }
    try {
        # Noms complets approuvés uniquement : les composants auxiliaires ne prouvent pas l'installation.
        $aliases = switch ($app) {
            'Microsoft 365 / Office' { @('Microsoft 365 Apps for enterprise', 'Microsoft 365 Apps for business', 'Microsoft Office Professional Plus 2019', 'Microsoft Office Professional Plus 2021', 'Microsoft Office LTSC Professional Plus 2021', 'Microsoft Office Standard 2019', 'Microsoft Office Standard 2021', 'Microsoft Office LTSC Standard 2021', 'Microsoft Office Home and Business 2019', 'Microsoft Office Home and Business 2021', 'Microsoft Office Home and Student 2019', 'Microsoft Office Home and Student 2021') }
            'Adobe Acrobat' { @('Adobe Acrobat', 'Adobe Acrobat (64-bit)') } # PDF reader capability, not paid Acrobat entitlement.
            default { @($app) }
        }
        if ($app -eq 'Microsoft 365 / Office') {
            $aliases = @($aliases | ForEach-Object { $_; "$_ - fr-ca"; "$_ - en-us"; "$_ - fr-fr" })
        }
        $appxAliases = if ($app -eq 'Lenovo Vantage') { @('E046963F.LenovoCompanion', 'E0469640.LenovoVantage') } else { @($app) }
        $hit = $installees | Where-Object { $_.DisplayName -and $aliases -contains ([string]$_.DisplayName).Trim() } | Select-Object -First 1
        $hitAppx = $appx | Where-Object { $_.Name -and $appxAliases -contains ([string]$_.Name).Trim() } | Select-Object -First 1
        if ($hit) { Add-Check 'Applications' $app 'OK' ("{0} {1}" -f $hit.DisplayName, $hit.DisplayVersion) }
        elseif ($hitAppx) { Add-Check 'Applications' $app 'OK' ("Application Store : {0} {1}" -f $hitAppx.Name, $hitAppx.Version) }
        elseif ($app -eq 'Lenovo Vantage' -and (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).Manufacturer -notmatch 'Lenovo') { Add-Check 'Applications' $app 'A VERIFIER' 'Optionnelle selon le fabricant' }
        else { Add-Check 'Applications' $app 'ECHEC' 'Non détectée' }
    } catch { Add-Check 'Applications' $app 'A VERIFIER' 'Vérification applicative incomplète' }
}

# --- 8. Clavier : langues ----------------------------------------------------
try {
    $langs = @(Get-WinUserLanguageList)
    $tags = @($langs | ForEach-Object { $_.LanguageTag })
    $inattendues = @($tags | Where-Object { $Config.Keyboards -notcontains $_ })
    $manquantes = @($Config.Keyboards | Where-Object { $tags -notcontains $_ })
    if ($tags.Count -eq 0) { Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'A VERIFIER' 'Liste des langues vide' }
    elseif ($inattendues.Count -gt 0 -or $manquantes.Count -gt 0) {
        Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'ECHEC' ("Langues inattendues : {0} ; manquantes : {1}" -f ($inattendues -join ', '), ($manquantes -join ', '))
    } else {
        $tips = @($langs | ForEach-Object { $_.InputMethodTips })
        if ($tips.Count -eq 0) { Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'A VERIFIER' 'Méthodes de saisie non lisibles' }
        elseif ($Config.Keyboards.Count -eq 1 -and $Config.Keyboards[0] -eq 'fr-CA' -and @($tips | Where-Object { $_ -ne '0C0C:00001009' }).Count -eq 0) {
            # Profil français (Canada), disposition Français (Canada) ; exclut notamment le clavier US.
            Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'OK' ("Langue : fr-CA ; clavier : {0}" -f ($tips -join ', '))
        } elseif ($Config.Keyboards.Count -eq 1 -and $Config.Keyboards[0] -eq 'fr-CA') {
            Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'ECHEC' ("Claviers inattendus : {0} (attendu : 0C0C:00001009)" -f ($tips -join ', '))
        } else { Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'A VERIFIER' 'Disposition clavier à valider pour les langues configurées' }
    }
} catch { Add-Check 'Configuration' 'Clavier FR-CA uniquement' 'A VERIFIER' 'Lecture impossible (lancer dans la session usager)' }

# --- 9. Applications par défaut ---------------------------------------------
try {
    $pdfProg = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' -ErrorAction Stop).ProgId
    if ($pdfProg -match '^(?:AcroExch|Acrobat)\.Document\.(?:DC|2015|2017|2020)$') { Add-Check 'Configuration' 'PDF par défaut = Adobe' 'OK' $pdfProg }
    elseif ($pdfProg) { Add-Check 'Configuration' 'PDF par défaut = Adobe' 'ECHEC' ("Actuel : {0}" -f $pdfProg) }
    else { Add-Check 'Configuration' 'PDF par défaut = Adobe' 'A VERIFIER' 'Association non définie' }
} catch { Add-Check 'Configuration' 'PDF par défaut = Adobe' 'A VERIFIER' 'Association non lisible' }
try {
    $httpProg = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
    $httpsProg = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId
    if (-not $httpProg -or -not $httpsProg) { Add-Check 'Configuration' 'Navigateur par défaut = Chrome' 'A VERIFIER' 'Association HTTP ou HTTPS non définie' }
    elseif ($httpProg -eq 'ChromeHTML' -and $httpsProg -eq 'ChromeHTML') { Add-Check 'Configuration' 'Navigateur par défaut = Chrome' 'OK' ("HTTP : {0} ; HTTPS : {1}" -f $httpProg, $httpsProg) }
    else { Add-Check 'Configuration' 'Navigateur par défaut = Chrome' 'ECHEC' ("HTTP : {0} ; HTTPS : {1}" -f $httpProg, $httpsProg) }
} catch { Add-Check 'Configuration' 'Navigateur par défaut = Chrome' 'A VERIFIER' 'Association HTTP ou HTTPS non lisible' }

# --- 10. Imprimante ----------------------------------------------------------
try {
    $virtuelles = 'OneNote|PDF|XPS|Fax|OneDrive'
    $imp = Get-Printer -ErrorAction Stop | Where-Object { $_.Name -notmatch $virtuelles }
    if ($Config.PrinterName) { $imp = $imp | Where-Object { $_.Name -match [regex]::Escape($Config.PrinterName) } }
    if ($imp) { Add-Check 'Configuration' 'Imprimante installée' 'OK' (($imp | ForEach-Object { $_.Name }) -join ' ; ') }
    else { Add-Check 'Configuration' 'Imprimante installée' 'ECHEC' 'Aucune imprimante réelle détectée' }
} catch { Add-Check 'Configuration' 'Imprimante installée' 'A VERIFIER' 'Lecture impossible' }

# --- 11. Langue d'Office -------------------------------------------------------
$lr = Get-ItemProperty 'HKCU:\Software\Microsoft\Office\16.0\Common\LanguageResources' -ErrorAction SilentlyContinue
if ($lr -and ($lr.UILanguage -in 3084, 1036)) { Add-Check 'Configuration' 'Office en français' 'OK' ("UILanguage = {0}" -f $lr.UILanguage) }
elseif ($lr -and $lr.UILanguage) { Add-Check 'Configuration' 'Office en français' 'ECHEC' ("UILanguage = {0} (3084/1036 attendu)" -f $lr.UILanguage) }
else { Add-Check 'Configuration' 'Office en français' 'A VERIFIER' 'Office pas encore ouvert dans cette session (clé absente)' }

# --- 12. BitLocker -------------------------------------------------------------
try {
    $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
    if ($bl.ProtectionStatus -eq 'On') { Add-Check 'Sécurité' 'BitLocker actif (C:)' 'OK' ("Chiffré à {0} %" -f $bl.EncryptionPercentage) }
    else { Add-Check 'Sécurité' 'BitLocker actif (C:)' 'ECHEC' ("ProtectionStatus : {0}" -f $bl.ProtectionStatus) }
} catch { Add-Check 'Sécurité' 'BitLocker actif (C:)' 'A VERIFIER' 'Lecture impossible (droits admin requis)' }

# --- Points manuels (non vérifiables par script) --------------------------------
$Manuels = @(
    'Signature courriel conforme (pas de virgule sans titre)',
    'MFA fonctionnel : Microsoft Authenticator (+ DUO si accès TS)',
    'Police par défaut Arial 10 dans Word, Excel, PowerPoint et Outlook',
    'Boîte Outlook entièrement en français (vérification visuelle)',
    'Icônes Office et Chrome épinglées à la barre des tâches',
    'Raccourcis web du client présents (Chrome/Edge)',
    'Accès TS : apps publiées sur le bureau + Log Off (icône rouge OFF)',
    'Code d''ouverture de l''ordinateur défini (6 chiffres du billet BZ)',
    'Teams : groupes du client accessibles',
    'Test final : session usager complète et fonctionnelle'
)

# ============================ RAPPORT ============================
$ok     = ($Resultats | Where-Object { $_.Etat -eq 'OK' }).Count
$echec  = ($Resultats | Where-Object { $_.Etat -eq 'ECHEC' }).Count
$verif  = ($Resultats | Where-Object { $_.Etat -eq 'A VERIFIER' }).Count

Write-Host ""
Write-Host ("RÉSULTAT : {0} OK · {1} ÉCHEC · {2} À VÉRIFIER (+{3} points manuels)" -f $ok, $echec, $verif, $Manuels.Count) -ForegroundColor 'Yellow'

$badge = @{ 'OK' = '#16763D|#e6f2ea|&#10004; OK'; 'ECHEC' = '#B4234A|#fbe9ee|&#10008; ÉCHEC'; 'A VERIFIER' = '#B45309|#fdf3e3|&#9888; À VÉRIFIER' }
function HtmlEnc([string]$s) {
    return [System.Net.WebUtility]::HtmlEncode($s)
}
$lignes = ''
$catPrec = ''
foreach ($r in $Resultats) {
    if ($r.Categorie -ne $catPrec) {
        $lignes += "<tr class='sec'><td colspan='3'>$(HtmlEnc $r.Categorie)</td></tr>"
        $catPrec = $r.Categorie
    }
    $b = $badge[$r.Etat].Split('|')
    $lignes += "<tr><td>$(HtmlEnc $r.Nom)</td><td style='text-align:center'><span class='bdg' style='color:$($b[0]);background:$($b[1])'>$($b[2])</span></td><td class='det'>$(HtmlEnc $r.Detail)</td></tr>"
}
$manuelLis = ($Manuels | ForEach-Object { "<li>&#9744; $(HtmlEnc $_)</li>" }) -join ''
$dt = Get-Date -Format 'yyyy-MM-dd HH:mm'
$complete = $echec -eq 0 -and $verif -eq 0 -and $Manuels.Count -eq 0
$couleurGlobal = if ($complete) { '#16763D' } else { '#B45309' }
$verdict = if ($complete) { 'CONFORME' } elseif ($echec -gt 0) { "NON CONFORME — $echec échec(s), $verif à vérifier et $($Manuels.Count) points manuels non validés" } else { "NON VALIDÉ — $verif à vérifier et $($Manuels.Count) points manuels non validés" }

$html = @"
<!doctype html><html lang='fr-CA'><head><meta charset='utf-8'><title>Audit poste $(HtmlEnc $env:COMPUTERNAME)</title><style>
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Segoe UI',system-ui,sans-serif;margin:0;background:#eef1f6;color:#1b2330;font-size:14px}
.wrap{max-width:900px;margin:0 auto;padding:18px}
.band{background:linear-gradient(130deg,#0F1D38,#1b3566 60%,#235089);color:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px}
.logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#1C6EB4,#3b8ad4);display:flex;align-items:center;justify-content:center;font-weight:700}
.band h1{margin:0;font-size:1.15rem}.band .k{font-size:.66rem;letter-spacing:2.5px;text-transform:uppercase;color:#aac4e4}
.band .r{margin-left:auto;text-align:right;font-size:.74rem;color:#cdddf0;line-height:1.5}
.kpis{display:flex;gap:10px;margin:12px 0}
.kpi{flex:1;background:#fff;border:1px solid #e2e7ee;border-radius:9px;padding:10px 12px;border-top:3px solid #1C6EB4}
.kpi b{font-size:1.3rem}.kpi span{display:block;font-size:.65rem;color:#6b7686;text-transform:uppercase;letter-spacing:.5px}
.verdict{background:#fff;border:2px solid $couleurGlobal;color:$couleurGlobal;border-radius:9px;padding:10px 14px;font-weight:700;margin-bottom:12px}
table{width:100%;border-collapse:collapse;background:#fff;font-size:.84rem}
th{background:#0F1D38;color:#fff;padding:7px 10px;text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.6px}
td{border:1px solid #d7dee8;padding:6px 10px;vertical-align:top}
tr.sec td{background:#e2eaf4;font-weight:700;color:#0F1D38;border-left:3px solid #1C6EB4}
.bdg{display:inline-block;padding:1px 10px;border-radius:99px;font-size:.7rem;font-weight:700;white-space:nowrap}
.det{color:#49536a;font-size:.78rem}
h2{color:#0F1D38;font-size:1rem;margin:18px 0 8px}
ul{background:#fff;border:1px solid #e2e7ee;border-radius:9px;margin:0;padding:12px 12px 12px 30px}
li{margin:4px 0}
.foot{text-align:center;color:#9aa4b2;font-size:.68rem;margin-top:14px}
.sig{margin-top:22px;display:flex;gap:40px;font-size:.8rem;color:#444}
.sig div{flex:1;border-top:1.5px solid #333;padding-top:5px}
@media print{body{background:#fff}.wrap{padding:0}}
</style></head><body><div class='wrap'>
<div class='band'><div class='logo'>BZ</div>
<div><div class='k'>Audit de montage de poste</div><h1>$(HtmlEnc $env:COMPUTERNAME)</h1></div>
<div class='r'>Client : $(HtmlEnc $Config.ClientName)<br>Usager : $(HtmlEnc $env:USERNAME)<br>$(HtmlEnc $dt)</div></div>
<div class='kpis'>
<div class='kpi' style='border-top-color:#16763D'><b style='color:#16763D'>$ok</b><span>Conformes</span></div>
<div class='kpi' style='border-top-color:#B4234A'><b style='color:#B4234A'>$echec</b><span>Échecs</span></div>
<div class='kpi' style='border-top-color:#B45309'><b style='color:#B45309'>$verif</b><span>À vérifier</span></div>
<div class='kpi'><b>$($Manuels.Count)</b><span>Points manuels</span></div>
</div>
<div class='verdict'>$verdict</div>
<table><tr><th>Contrôle</th><th style='width:110px'>État</th><th style='width:44%'>Détail</th></tr>$lignes</table>
<h2>Points à valider manuellement</h2><ul>$manuelLis</ul>
<div class='sig'><div>Signature du technicien</div><div>Date</div></div>
<div class='foot'>Audit de montage de poste — BZ v1 · généré automatiquement · $(HtmlEnc $dt)</div>
</div></body></html>
"@

$fichier = Join-Path $ReportDir ("AuditPoste_{0}_{1}.html" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd_HHmm'))
try {
    if (-not (Test-Path -LiteralPath $ReportDir -PathType Container)) { throw 'Dossier de rapport introuvable' }
    $html | Out-File -LiteralPath $fichier -Encoding utf8 -ErrorAction Stop
} catch { Write-Error ('Écriture du rapport impossible : {0}' -f $_.Exception.Message); exit 1 }
Write-Host ""
Write-Host "Rapport : $fichier" -ForegroundColor Cyan
try { Start-Process -FilePath $fichier } catch {}
exit $(if ($complete) { 0 } else { 1 })
`;

// Only complete, unambiguous standard steps map to existing single-result probes.
// Composite steps (Autopilot, licensed Adobe, shortcuts, default apps, etc.) stay manual:
// a partial probe must never mark the entire instruction OK.
const STANDARD_PROBES: Record<string, { title: string; block: number }> = {
  'bz-1-1': { title: 'Installer / valider Windows 11 Pro', block: 1 },
  'bz-1-4': { title: 'Ajouter le compte admin local bzinc', block: 5 },
  'bz-2-1': { title: 'Mises à jour Windows', block: 6 },
  'bz-2-7': { title: "Installer l'imprimante du client", block: 10 },
  'bz-3-3': { title: 'Clavier : retirer les autres langues, garder FR/CA', block: 8 },
};

function validateProcedure(options: WorkstationAuditOptions): AuditProcedureSection[] {
  const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !value.includes('\u0000');
  const sections = options.procedure?.sections;
  if (!validText(options.procedure?.name, 250) || !options.procedure?.name.trim() ||
      (options.procedure?.source !== undefined && !validText(options.procedure.source, 250)) ||
      !Array.isArray(sections) || sections.length > 30 ||
      !sections.every(section => section && validText(section.title, 250) && Array.isArray(section.steps) && section.steps.length <= 300 &&
        section.steps.every((step: AuditProcedureStep) => step && validText(step.id, 100) && validText(step.title, 250) &&
          validText(step.note, 4000) && (step.commentaire === undefined || validText(step.commentaire, 4000)) &&
          (step.etat === undefined || ['todo', 'fait', 'na'].includes(step.etat)))) ||
      sections.reduce((n, section) => n + section.steps.length, 0) > 300) {
    throw new Error('Données de procédure invalides ou trop volumineuses');
  }
  return sections;
}

function procedureScript(options: WorkstationAuditOptions, literals: Record<string, string>): string {
  const sections = validateProcedure(options);
  // Discover structural boundaries only in the fixed template. A client value may
  // legitimately contain a newline followed by a line resembling a block marker.
  const blocks = [...SCRIPT_TEMPLATE.matchAll(/^# --- (\d+)\. /gm)].map(match => ({number: Number(match[1]), start: match.index}));
  const manualStart = SCRIPT_TEMPLATE.indexOf('# --- Points manuels');
  const reportStart = SCRIPT_TEMPLATE.indexOf('# ============================ RAPPORT');
  const render = (fragment: string) => fragment.replace(/__CLIENT__|__PREFIX__|__ADMIN__|__KEYBOARDS__|__PRINTER__|__APPS__/g, key => literals[key]);
  const header = render(SCRIPT_TEMPLATE.slice(0, blocks[0].start));
  let checks = '';
  let applicable = 0;
  const mappedBlocks = new Set<number>();
  const technicalProbe = (number: number, index: number) => {
    const probe = render(SCRIPT_TEMPLATE.slice(blocks[index].start, blocks[index + 1]?.start ?? manualStart));
    const missing = number === 5 ? ["[string]::IsNullOrWhiteSpace($Config.AdminLocal)", 'Compte administrateur local', 'Compte administrateur du client non défini'] :
      number === 8 ? ["@($Config.Keyboards | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -eq 0", 'Clavier attendu', 'Aucun clavier configuré'] :
      number === 10 ? ["[string]::IsNullOrWhiteSpace($Config.PrinterName)", 'Imprimante du client', "Motif de l'imprimante du client non défini"] :
      number === 7 ? ["@($Config.Apps | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -eq 0", 'Applications configurées', 'Aucune application configurée'] : undefined;
    return missing ? `if (${missing[0]}) { Add-Check 'Contrôles techniques supplémentaires' ${psLiteral(missing[1])} 'A VERIFIER' ${psLiteral(missing[2])} } else {\n${probe}}\n` : probe;
  };
  for (const section of sections) {
    const included = section.steps.filter(step => step.etat !== 'na');
    applicable += included.length;
    if (!included.length) {
      // A dossier section whose steps are all N/A is outside the audit scope.
      if (section.steps.length === 0) checks += `Add-Check ${psLiteral(section.title)} 'Aucune étape définie' 'A VERIFIER' 'Section à valider manuellement'\n`;
      continue;
    }
    for (const step of included) {
      const mapped = Object.prototype.hasOwnProperty.call(STANDARD_PROBES, step.id) ? STANDARD_PROBES[step.id] : undefined;
      const block = mapped?.title === step.title && !(step.id === 'bz-1-4' && options.adminLocal !== 'bzinc') &&
        !(step.id === 'bz-2-7' && !options.printerName.trim()) ? mapped.block : undefined;
      const note = [step.note, step.commentaire || ''].filter(Boolean).join(' ; ');
      if (block === undefined) {
        checks += `Add-Check ${psLiteral(section.title)} ${psLiteral(step.title)} 'A VERIFIER' ${psLiteral(['Validation manuelle requise', note].filter(Boolean).join(' — '))}\n`;
        continue;
      }
      const index = blocks.findIndex(item => item.number === block);
      if (index < 0) throw new Error('Bloc de contrôle de procédure absent');
      mappedBlocks.add(block);
      checks += `# Contrôle standard ${step.id}\n$before = $script:Resultats.Count\n`;
      if (note.trim()) checks += '$script:ManualStepRequiresVerification = $true\n';
      checks += technicalProbe(block, index);
      if (note.trim()) checks += '$script:ManualStepRequiresVerification = $false\n';
      checks += `foreach ($row in @($script:Resultats | Select-Object -Skip $before)) {\n`;
      checks += `    $row.Categorie = ${psLiteral(section.title)}\n    $row.Nom = ${psLiteral(step.title)}\n`;
      checks += `    $row.Detail = (@($row.Detail, ${psLiteral(note)}) | Where-Object { $_ }) -join ' — '\n`;
      checks += `}\n`;
      checks += `if ($script:Resultats.Count -eq $before) { Add-Check ${psLiteral(section.title)} ${psLiteral(step.title)} 'A VERIFIER' ${psLiteral(['Contrôle indisponible', note].filter(Boolean).join(' — '))} }\n`;
    }
  }
  if (!applicable) checks += "Add-Check 'Procédure' 'Aucune étape applicable' 'A VERIFIER' 'Aucune étape sélectionnée ne permet de valider le poste'\n";
  // Client settings are supplementary technical evidence, never validation of a procedure step.
  for (const number of [2, 5, 7, 8, 10]) {
    if (mappedBlocks.has(number)) continue;
    const index = blocks.findIndex(item => item.number === number);
    if (index < 0) throw new Error('Bloc de contrôle client absent');
    checks += `# Contrôles techniques supplémentaires — ${number}\n$technicalBefore = $script:Resultats.Count\n`;
    checks += technicalProbe(number, index);
    checks += "foreach ($row in @($script:Resultats | Select-Object -Skip $technicalBefore)) { $row.Categorie = 'Contrôles techniques supplémentaires' }\n";
  }
  // No generic BZ checklist in procedure mode: each selected step already has its own report row.
  let report = '$Manuels = @()\n\n' + render(SCRIPT_TEMPLATE.slice(reportStart));
  report = report.replace("<div class='band'><div class='logo'>BZ</div>", "<div class='band'><div class='logo'>Audit</div>");
  report = report.replace('Client : $(HtmlEnc $Config.ClientName)<br>', 'Client : $(HtmlEnc $Config.ClientName)<br>Procédure : $(HtmlEnc $ProcedureName)<br>$(if ($ProcedureSource) { "Source : $(HtmlEnc $ProcedureSource)<br>" })');
  report = report.replace('Audit de montage de poste — BZ v1 · généré automatiquement', 'Audit de montage de poste · $(HtmlEnc $ProcedureName) · généré automatiquement');
  report = report.replace('<h2>Points à valider manuellement</h2><ul>$manuelLis</ul>', '');
  return header.replace('v1 — BZ.', 'procédure sélectionnée.') + `$ProcedureName = ${psLiteral(options.procedure!.name)}\n$ProcedureSource = ${psLiteral(options.procedure!.source || '')}\n\n` + checks + report;
}

export function generateWorkstationAuditScript(options: WorkstationAuditOptions = DEFAULT_WORKSTATION_AUDIT_OPTIONS): string {
  const literals: Record<string, string> = {
    __CLIENT__: psLiteral(options.clientName),
    __PREFIX__: psLiteral(options.computerPrefix),
    __ADMIN__: psLiteral(options.adminLocal),
    __KEYBOARDS__: psArray(options.keyboards),
    __PRINTER__: psLiteral(options.printerName),
    __APPS__: psArray(options.apps),
  };
  if (options.procedure !== undefined) return procedureScript(options, literals);
  return SCRIPT_TEMPLATE.replace(/__CLIENT__|__PREFIX__|__ADMIN__|__KEYBOARDS__|__PRINTER__|__APPS__/g, key => literals[key]);
}
