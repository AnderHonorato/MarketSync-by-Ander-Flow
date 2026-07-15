import { useEffect, useState } from "react";
import { getUnofficialAccess, setupUnofficialAccess, verifyUnofficialAccess, recoverUnofficialAccess, resetUnofficialAccess } from "../api";
import { KeyRound, LoaderCircle, Lock, ShieldCheck, X } from "lucide-react";

type Step = "setup" | "unlock" | "recover" | "reset";

export function LockModal({ csrfToken, onUnlock, onClose }: { csrfToken: string | null; onUnlock: () => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>("unlock");
  const [password, setPassword] = useState("");
  const [recoveryQuestion, setRecoveryQuestion] = useState("");
  const [recoveryAnswer, setRecoveryAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const init = async () => {
    setBusy(true);
    try {
      const result = await getUnofficialAccess();
      setConfigured(result.configured);
      if (!result.configured) setStep("setup");
    } catch {
      setConfigured(false);
      setError("Erro ao verificar configuracao.");
    }
    finally { setBusy(false); }
  };

  useEffect(() => {
    void init();
  }, []);

  if (configured === null && step === "unlock") {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <section className="modal lock-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div><p className="eyebrow">Código de liberação</p><h2>Verificando...</h2></div>
            <button className="icon-button" onClick={onClose}><X /></button>
          </div>
          <div className="lock-body"><LoaderCircle className="spin" /><span>Consultando configuração...</span></div>
        </section>
      </div>
    );
  }

  const handleSetup = async () => {
    if (password.length < 8) { setError("A senha deve ter pelo menos 8 caracteres."); return; }
    if (recoveryQuestion.trim().length < 10) { setError("A pergunta de recuperação deve ter pelo menos 10 caracteres."); return; }
    if (recoveryAnswer.trim().length < 2) { setError("Informe uma resposta para a pergunta."); return; }
    setBusy(true); setError("");
    try {
      await setupUnofficialAccess(csrfToken, password, recoveryQuestion.trim(), recoveryAnswer.trim());
      onUnlock();
    } catch (reason: unknown) { setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Erro ao configurar."); setBusy(false); }
  };

  const handleUnlock = async () => {
    if (!password) { setError("Digite o código de liberação."); return; }
    setBusy(true); setError("");
    try {
      await verifyUnofficialAccess(csrfToken, password);
      onUnlock();
    } catch (reason: unknown) { setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Código incorreto."); setBusy(false); }
  };

  const handleRecover = async () => {
    if (!recoveryAnswer.trim()) { setError("Responda a pergunta de recuperação."); return; }
    setBusy(true); setError("");
    try {
      await recoverUnofficialAccess(csrfToken, recoveryAnswer.trim());
      setStep("reset");
    } catch (reason: unknown) { setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Resposta incorreta."); setBusy(false); }
  };

  const handleReset = async () => {
    if (newPassword.length < 8) { setError("A nova senha deve ter pelo menos 8 caracteres."); return; }
    setBusy(true); setError("");
    try {
      await resetUnofficialAccess(csrfToken, recoveryAnswer.trim(), newPassword);
      onUnlock();
    } catch (reason: unknown) { setError(reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Erro ao redefinir."); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal lock-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Código de liberação</p>
            <h2>
              {step === "setup" ? "Primeiro acesso" : step === "recover" ? "Recuperar código" : step === "reset" ? "Redefinir código" : "Consultas públicas"}
            </h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        <div className="lock-body">
          {step === "setup" && (
            <>
              <div className="notice"><ShieldCheck /><span>Crie um código de 8 ou mais caracteres para liberar as consultas públicas. Guarde a pergunta e resposta para recuperação.</span></div>
              <label className="field"><span>Código de liberação</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoFocus /></label>
              <label className="field"><span>Pergunta de recuperação</span><input value={recoveryQuestion} onChange={(e) => setRecoveryQuestion(e.target.value)} placeholder="Ex.: Qual o nome do meu primeiro pet?" /></label>
              <label className="field"><span>Resposta</span><input type="text" value={recoveryAnswer} onChange={(e) => setRecoveryAnswer(e.target.value)} placeholder="Sua resposta secreta" /></label>
              {error && <div className="notice danger">{error}</div>}
              <div className="modal-actions">
                <button className="button" onClick={onClose}>Cancelar</button>
                <button className="button primary" disabled={busy} onClick={handleSetup}>{busy ? <LoaderCircle className="spin" /> : <Lock />}Salvar e ativar</button>
              </div>
            </>
          )}
          {step === "unlock" && (
            <>
              <div className="notice"><KeyRound /><span>Digite o código de liberação para ativar as consultas públicas.</span></div>
              <label className="field"><span>Código de liberação</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite o código..." autoFocus onKeyDown={(e) => { if (e.key === "Enter") void handleUnlock(); }} /></label>
              {error && <div className="notice danger">{error}</div>}
              <div className="modal-actions">
                <button className="button" onClick={onClose}>Cancelar</button>
                <button className="text-button" onClick={() => { setStep("recover"); setError(""); }}>Esqueci o código</button>
                <button className="button primary" disabled={busy} onClick={handleUnlock}>{busy ? <LoaderCircle className="spin" /> : <Lock />}Ativar</button>
              </div>
            </>
          )}
          {step === "recover" && (
            <>
              <div className="notice"><ShieldCheck /><span>Responda a pergunta secreta para recuperar seu acesso.</span></div>
              <label className="field"><span>Resposta de recuperação</span><input value={recoveryAnswer} onChange={(e) => setRecoveryAnswer(e.target.value)} placeholder="Sua resposta secreta" autoFocus onKeyDown={(e) => { if (e.key === "Enter") void handleRecover(); }} /></label>
              {error && <div className="notice danger">{error}</div>}
              <div className="modal-actions">
                <button className="button" onClick={() => { setStep("unlock"); setError(""); }}>Voltar</button>
                <button className="button primary" disabled={busy} onClick={handleRecover}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}Verificar</button>
              </div>
            </>
          )}
          {step === "reset" && (
            <>
              <div className="notice"><ShieldCheck /><span>Resposta confirmada. Defina um novo código de liberação.</span></div>
              <label className="field"><span>Novo código</span><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoFocus onKeyDown={(e) => { if (e.key === "Enter") void handleReset(); }} /></label>
              {error && <div className="notice danger">{error}</div>}
              <div className="modal-actions">
                <button className="button" onClick={onClose}>Cancelar</button>
                <button className="button primary" disabled={busy} onClick={handleReset}>{busy ? <LoaderCircle className="spin" /> : <Lock />}Salvar novo código</button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
