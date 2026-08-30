'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ApiError,
  FarmField,
  Notification,
  User,
  WeatherEvent,
  api,
  toPercentage,
} from '@/lib/api';

const SELECTED_USER_KEY = 'agrobot-selected-user';

const eventMeta: Record<WeatherEvent, { label: string; symbol: string; tone: string }> = {
  rain: { label: 'Lluvia', symbol: '☂', tone: 'bg-[#e6f0f4] text-[#275d70]' },
  frost: { label: 'Helada', symbol: '✣', tone: 'bg-[#e9eef8] text-[#405d8b]' },
  hail: { label: 'Granizo', symbol: '◆', tone: 'bg-[#eeeaf5] text-[#675582]' },
  wind: { label: 'Viento', symbol: '≈', tone: 'bg-[#edf0e7] text-[#536540]' },
};

type View = 'overview' | 'fields' | 'notifications' | 'demo';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(`${value}T12:00:00`),
  );
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado.';
}

function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [fields, setFields] = useState<FarmField[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [view, setView] = useState<View>('overview');
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [alertFieldId, setAlertFieldId] = useState('');
  const [alertEvent, setAlertEvent] = useState<WeatherEvent>('rain');
  const [alertThreshold, setAlertThreshold] = useState(70);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [editThreshold, setEditThreshold] = useState(70);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [internalToken, setInternalToken] = useState('');
  const [forecastFieldId, setForecastFieldId] = useState('');
  const [forecastEvent, setForecastEvent] = useState<WeatherEvent>('rain');
  const [forecastDate, setForecastDate] = useState(tomorrow);
  const [forecastProbability, setForecastProbability] = useState(80);
  const [submitting, setSubmitting] = useState(false);

  const showNotice = useCallback((message: string) => {
    setError('');
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  }, []);

  const loadUserData = useCallback(async (userId: string, quiet = false) => {
    if (!quiet) setDataLoading(true);
    try {
      const [fieldResult, alertResult, notificationResult] = await Promise.all([
        api.listFields(userId),
        api.listAlerts(userId),
        api.listNotifications(userId),
      ]);
      setFields(fieldResult);
      setAlerts(alertResult);
      setNotifications(notificationResult);
      setAlertFieldId((current) => current || fieldResult[0]?.id || '');
      setForecastFieldId((current) => current || fieldResult[0]?.id || '');
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      if (!quiet) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .listUsers()
      .then((result) => {
        if (!active) return;
        setUsers(result);
        const storedId = window.localStorage.getItem(SELECTED_USER_KEY);
        const storedUser = result.find((user) => user.id === storedId);
        if (storedUser) {
          setSelectedUser(storedUser);
          void loadUserData(storedUser.id);
        }
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [loadUserData]);

  useEffect(() => {
    if (!selectedUser) return;
    const interval = window.setInterval(() => {
      api
        .listNotifications(selectedUser.id)
        .then(setNotifications)
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadUserData, selectedUser]);

  const unreadCount = notifications.filter((item) => item.read_at === null).length;
  const displayedNotifications = unreadOnly
    ? notifications.filter((item) => item.read_at === null)
    : notifications;

  const fieldById = useMemo(
    () => Object.fromEntries(fields.map((field) => [field.id, field])),
    [fields],
  );
  const alertById = useMemo(
    () => Object.fromEntries(alerts.map((alert) => [alert.id, alert])),
    [alerts],
  );

  function chooseUser(user: User) {
    window.localStorage.setItem(SELECTED_USER_KEY, user.id);
    setFields([]);
    setAlerts([]);
    setNotifications([]);
    setAlertFieldId('');
    setForecastFieldId('');
    setSelectedUser(user);
    setView('overview');
    void loadUserData(user.id);
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    if (!newUserName.trim()) return;
    setSubmitting(true);
    try {
      const user = await api.createUser(newUserName.trim());
      setUsers((current) => [...current, user]);
      setNewUserName('');
      chooseUser(user);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function createField(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser || !newFieldName.trim()) return;
    setSubmitting(true);
    try {
      const field = await api.createField(selectedUser.id, newFieldName.trim());
      setFields((current) => [...current, field]);
      setAlertFieldId((current) => current || field.id);
      setForecastFieldId((current) => current || field.id);
      setNewFieldName('');
      showNotice('Campo creado correctamente.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function createAlert(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser || !alertFieldId) return;
    setSubmitting(true);
    try {
      const alert = await api.createAlert(selectedUser.id, {
        field_id: alertFieldId,
        event_type: alertEvent,
        thresholdPercent: alertThreshold,
      });
      setAlerts((current) => [...current, alert]);
      showNotice('Alerta activada. El worker ya puede evaluarla.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function updateAlert(alert: Alert, changes: { thresholdPercent?: number; is_active?: boolean }) {
    if (!selectedUser) return;
    try {
      const updated = await api.updateAlert(selectedUser.id, alert.id, changes);
      setAlerts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingAlertId(null);
      showNotice('Alerta actualizada.');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function deactivateAlert(alert: Alert) {
    if (!selectedUser) return;
    try {
      await api.deactivateAlert(selectedUser.id, alert.id);
      setAlerts((current) =>
        current.map((item) => (item.id === alert.id ? { ...item, is_active: false } : item)),
      );
      showNotice('Alerta desactivada. Su historial se conserva.');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function markRead(notification: Notification) {
    if (!selectedUser || notification.read_at) return;
    try {
      const updated = await api.markNotificationRead(selectedUser.id, notification.id);
      setNotifications((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function submitForecast(event: FormEvent) {
    event.preventDefault();
    if (!internalToken || !forecastFieldId) {
      setError('Ingresá el token interno y seleccioná un campo.');
      return;
    }
    setSubmitting(true);
    try {
      await api.upsertForecast(internalToken, {
        field_id: forecastFieldId,
        event_type: forecastEvent,
        forecast_date: forecastDate,
        probabilityPercent: forecastProbability,
      });
      showNotice('Pronóstico guardado. La alerta aparecerá en un máximo de 10 segundos.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f3ed] text-[#526157]">
        <div className="text-center"><span className="loading-dot" /><p className="mt-4 text-sm">Conectando con Agrobot…</p></div>
      </main>
    );
  }

  if (!selectedUser) {
    return (
      <UserSelector
        users={users}
        error={error}
        creating={creatingUser}
        submitting={submitting}
        name={newUserName}
        onNameChange={setNewUserName}
        onChoose={chooseUser}
        onCreate={createUser}
        onToggleCreate={() => setCreatingUser((current) => !current)}
      />
    );
  }

  const navItems: Array<{ id: View; label: string; symbol: string; badge?: number }> = [
    { id: 'overview', label: 'Resumen', symbol: '⌂' },
    { id: 'fields', label: 'Campos y alertas', symbol: '◫' },
    { id: 'notifications', label: 'Notificaciones', symbol: '●', badge: unreadCount },
    { id: 'demo', label: 'Clima demo', symbol: '☼' },
  ];

  return (
    <main className="min-h-screen bg-[#f2f2ec] text-[#18251c]">
      <header className="sticky top-0 z-20 border-b border-[#d8ddd4] bg-[#fbfcf8]/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1f5b3a] font-bold text-white">A</div>
            <div><p className="font-semibold tracking-tight">Agrobot</p><p className="text-xs text-[#6d786f]">Alertas climáticas</p></div>
          </div>
          <button onClick={() => { window.localStorage.removeItem(SELECTED_USER_KEY); setSelectedUser(null); }} className="flex items-center gap-3 rounded-xl border border-[#d9ded6] bg-white px-3 py-2 text-left transition hover:border-[#9db4a2]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e5eee5] text-sm font-semibold text-[#285d3c]">{selectedUser.name.charAt(0).toUpperCase()}</span>
            <span className="hidden sm:block"><strong className="block max-w-36 truncate text-sm">{selectedUser.name}</strong><span className="text-[11px] text-[#718077]">Cambiar usuario</span></span>
            <span className="text-[#819087]">⌄</span>
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[230px_1fr]">
        <aside className="hidden min-h-[calc(100vh-72px)] border-r border-[#d8ddd4] bg-[#f8f9f4] p-5 lg:block">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#89928c]">Navegación</p>
          <nav className="space-y-1">
            {navItems.map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />)}
          </nav>
          <div className="mt-10 rounded-2xl bg-[#e8eee5] p-4">
            <p className="text-xs font-semibold text-[#315740]">Evaluación automática</p>
            <p className="mt-2 text-xs leading-5 text-[#657367]">Celery agenda una evaluación cada 10 segundos.</p>
            <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-[#2c6441]"><span className="h-2 w-2 rounded-full bg-[#45a663]" />Activo</div>
          </div>
        </aside>

        <section className="min-w-0 px-4 pb-24 pt-7 sm:px-7 lg:px-10 lg:pb-10">
          <div className="mx-auto max-w-6xl">
            {error && <div role="alert" className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-[#e4beb4] bg-[#fff2ee] px-4 py-3 text-sm text-[#8b3e2f]"><span>{error}</span><button onClick={() => setError('')} aria-label="Cerrar error">×</button></div>}
            {notice && <div role="status" className="mb-5 rounded-xl border border-[#bcd8c2] bg-[#edf8ef] px-4 py-3 text-sm text-[#28603b]">{notice}</div>}
            {dataLoading ? (
              <div className="grid min-h-[50vh] place-items-center"><span className="loading-dot" /></div>
            ) : (
              <>
                {view === 'overview' && <Overview user={selectedUser} fields={fields} alerts={alerts} notifications={notifications} setView={setView} fieldById={fieldById} alertById={alertById} />}
                {view === 'fields' && <FieldsView fields={fields} alerts={alerts} newFieldName={newFieldName} setNewFieldName={setNewFieldName} createField={createField} alertFieldId={alertFieldId} setAlertFieldId={setAlertFieldId} alertEvent={alertEvent} setAlertEvent={setAlertEvent} alertThreshold={alertThreshold} setAlertThreshold={setAlertThreshold} createAlert={createAlert} submitting={submitting} editingAlertId={editingAlertId} editThreshold={editThreshold} startEditing={(alert) => { setEditingAlertId(alert.id); setEditThreshold(toPercentage(alert.threshold)); }} setEditThreshold={setEditThreshold} updateAlert={updateAlert} deactivateAlert={deactivateAlert} />}
                {view === 'notifications' && <NotificationsView notifications={displayedNotifications} unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly} markRead={markRead} fieldById={fieldById} alertById={alertById} refresh={() => void loadUserData(selectedUser.id, true)} />}
                {view === 'demo' && <DemoView fields={fields} internalToken={internalToken} setInternalToken={setInternalToken} forecastFieldId={forecastFieldId} setForecastFieldId={setForecastFieldId} forecastEvent={forecastEvent} setForecastEvent={setForecastEvent} forecastDate={forecastDate} setForecastDate={setForecastDate} probability={forecastProbability} setProbability={setForecastProbability} submit={submitForecast} submitting={submitting} />}
              </>
            )}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[#d6dcd3] bg-[#fbfcf8]/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        {navItems.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`relative flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] ${view === item.id ? 'font-semibold text-[#1f5b3a]' : 'text-[#738077]'}`}><span className="text-lg leading-none">{item.symbol}</span>{item.label.split(' ')[0]}{!!item.badge && <span className="absolute right-[22%] top-0 grid h-4 min-w-4 place-items-center rounded-full bg-[#bd5d3b] px-1 text-[9px] text-white">{item.badge}</span>}</button>)}
      </nav>
    </main>
  );
}

function UserSelector({ users, error, creating, submitting, name, onNameChange, onChoose, onCreate, onToggleCreate }: { users: User[]; error: string; creating: boolean; submitting: boolean; name: string; onNameChange: (value: string) => void; onChoose: (user: User) => void; onCreate: (event: FormEvent) => void; onToggleCreate: () => void }) {
  return (
    <main className="min-h-screen bg-[#f4f3ed] text-[#17231b]">
      <header className="border-b border-[#d9ddd3] bg-[#f9faf6]"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1f5b3a] font-bold text-white">A</div><div><p className="text-lg font-semibold tracking-tight">Agrobot</p><p className="text-xs text-[#657267]">Alertas climáticas</p></div></div><span className="rounded-full border border-[#cdd8ce] bg-white px-3 py-1.5 text-xs font-medium text-[#42604a]">Demo local</span></div></header>
      <section className="mx-auto grid min-h-[calc(100vh-81px)] max-w-6xl items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-xl"><p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[#a7652a]">Gestión preventiva</p><h1 className="text-4xl font-semibold leading-tight tracking-[-0.035em] sm:text-6xl">El clima cambia. Tu planificación no tiene por qué hacerlo.</h1><p className="mt-6 max-w-lg text-base leading-7 text-[#5d685f] sm:text-lg">Configurá umbrales por campo y recibí una señal clara cuando un pronóstico requiera tu atención.</p><div className="mt-8 flex gap-8 border-t border-[#d5dbd1] pt-6 text-sm"><div><strong className="block text-2xl text-[#1f5b3a]">24/7</strong>evaluación automática</div><div><strong className="block text-2xl text-[#1f5b3a]">4</strong>eventos climáticos</div></div></div>
        <section className="rounded-[28px] border border-[#d7ddd3] bg-white p-6 shadow-[0_24px_70px_rgba(39,61,45,0.12)] sm:p-8">
          <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#738078]">Acceso de demostración</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">¿Quién está ingresando?</h2><p className="mt-2 text-sm leading-6 text-[#68726b]">Elegí un usuario para administrar sus campos y alertas.</p></div>
          {error && <div role="alert" className="mb-4 rounded-xl bg-[#fff0ec] p-3 text-sm text-[#944631]">{error}</div>}
          <div className="max-h-64 space-y-3 overflow-auto pr-1">
            {users.map((user) => <button key={user.id} onClick={() => onChoose(user)} className="group flex w-full items-center gap-4 rounded-2xl border border-[#dfe3dc] px-4 py-4 text-left transition hover:border-[#76a181] hover:bg-[#f6faf5]"><span className="grid h-11 w-11 place-items-center rounded-full bg-[#e7efe7] font-semibold text-[#285d3c]">{user.name.charAt(0).toUpperCase()}</span><span className="flex-1"><strong className="block text-sm">{user.name}</strong><span className="text-xs text-[#7a847c]">Ingresar a su espacio</span></span><span className="text-lg text-[#7b8b7f] transition group-hover:translate-x-1">→</span></button>)}
            {users.length === 0 && <p className="rounded-2xl border border-dashed border-[#ced6cc] p-5 text-center text-sm text-[#6b776e]">Todavía no hay usuarios. Creá el primero para comenzar.</p>}
          </div>
          {creating ? <form onSubmit={onCreate} className="mt-5 flex gap-2"><label className="sr-only" htmlFor="new-user">Nombre del usuario</label><input id="new-user" autoFocus value={name} onChange={(event) => onNameChange(event.target.value)} minLength={1} maxLength={120} required placeholder="Nombre del usuario" className="min-w-0 flex-1 rounded-xl border border-[#cfd6cd] px-3 py-3 text-sm outline-none focus:border-[#4d815e]" /><button disabled={submitting} className="rounded-xl bg-[#1f5b3a] px-4 text-sm font-semibold text-white disabled:opacity-50">Crear</button></form> : <button onClick={onToggleCreate} className="mt-5 w-full rounded-xl bg-[#1f5b3a] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17472e]">Crear un nuevo usuario</button>}
          {creating && <button onClick={onToggleCreate} className="mt-3 w-full text-xs text-[#718077]">Cancelar</button>}
        </section>
      </section>
    </main>
  );
}

function NavButton({ item, active, onClick }: { item: { label: string; symbol: string; badge?: number }; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? 'bg-[#dfe9df] font-semibold text-[#24573a]' : 'text-[#667269] hover:bg-[#edf0e9]'}`}><span className="grid w-5 place-items-center text-base">{item.symbol}</span><span className="flex-1">{item.label}</span>{!!item.badge && <span className="grid min-w-5 place-items-center rounded-full bg-[#bd5d3b] px-1.5 py-0.5 text-[10px] text-white">{item.badge}</span>}</button>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8a6543]">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#657168] sm:text-base">{description}</p></div>;
}

function Overview({ user, fields, alerts, notifications, setView, fieldById, alertById }: { user: User; fields: FarmField[]; alerts: Alert[]; notifications: Notification[]; setView: (view: View) => void; fieldById: Record<string, FarmField>; alertById: Record<string, Alert> }) {
  const unread = notifications.filter((item) => !item.read_at);
  return <><SectionHeading eyebrow="Panel principal" title={`Buen día, ${user.name.split(' ')[0]}`} description="Una vista rápida de tus campos y de los eventos climáticos que requieren atención." /><div className="grid gap-4 sm:grid-cols-3"><StatCard label="Campos registrados" value={fields.length} detail="bajo seguimiento" tone="green" /><StatCard label="Alertas activas" value={alerts.filter((item) => item.is_active).length} detail={`de ${alerts.length} configuradas`} tone="amber" /><StatCard label="Sin leer" value={unread.length} detail="notificaciones" tone="red" /></div><div className="mt-7 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]"><div className="panel"><div className="panel-heading"><div><p className="panel-kicker">Atención</p><h2 className="panel-title">Notificaciones recientes</h2></div><button onClick={() => setView('notifications')} className="text-link">Ver todas →</button></div>{notifications.length ? <div className="divide-y divide-[#e4e7e1]">{notifications.slice(0, 4).map((item) => <NotificationRow key={item.id} notification={item} field={fieldById[alertById[item.alert_id]?.field_id]} compact />)}</div> : <EmptyState symbol="✓" title="Todo tranquilo" text="Las notificaciones aparecerán cuando un pronóstico supere alguno de tus umbrales." />}</div><div className="panel"><div className="panel-heading"><div><p className="panel-kicker">Cobertura</p><h2 className="panel-title">Tus campos</h2></div><button onClick={() => setView('fields')} className="text-link">Administrar →</button></div>{fields.length ? <div className="space-y-3">{fields.slice(0, 4).map((field) => { const count = alerts.filter((alert) => alert.field_id === field.id && alert.is_active).length; return <div key={field.id} className="flex items-center gap-3 rounded-xl bg-[#f3f5ef] p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#dce8da] text-[#2b6040]">◫</span><div className="flex-1"><p className="text-sm font-semibold">{field.name}</p><p className="text-xs text-[#718077]">{count} {count === 1 ? 'alerta activa' : 'alertas activas'}</p></div></div>; })}</div> : <EmptyState symbol="＋" title="Creá tu primer campo" text="Necesitás un campo antes de configurar alertas." action="Comenzar" onAction={() => setView('fields')} />}</div></div></>;
}

function StatCard({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: 'green' | 'amber' | 'red' }) {
  const colors = { green: 'bg-[#e3eee2] text-[#28603d]', amber: 'bg-[#f2e9d8] text-[#8a5b24]', red: 'bg-[#f2dfd8] text-[#9b4c35]' };
  return <div className="rounded-2xl border border-[#dfe3dc] bg-white p-5"><div className={`mb-4 grid h-9 w-9 place-items-center rounded-xl ${colors[tone]}`}>{tone === 'green' ? '◫' : tone === 'amber' ? '◎' : '!'}</div><p className="text-sm text-[#6d786f]">{label}</p><div className="mt-1 flex items-baseline gap-2"><strong className="text-3xl tracking-tight">{value}</strong><span className="text-xs text-[#88918b]">{detail}</span></div></div>;
}

function FieldsView({ fields, alerts, newFieldName, setNewFieldName, createField, alertFieldId, setAlertFieldId, alertEvent, setAlertEvent, alertThreshold, setAlertThreshold, createAlert, submitting, editingAlertId, editThreshold, startEditing, setEditThreshold, updateAlert, deactivateAlert }: { fields: FarmField[]; alerts: Alert[]; newFieldName: string; setNewFieldName: (value: string) => void; createField: (event: FormEvent) => void; alertFieldId: string; setAlertFieldId: (value: string) => void; alertEvent: WeatherEvent; setAlertEvent: (value: WeatherEvent) => void; alertThreshold: number; setAlertThreshold: (value: number) => void; createAlert: (event: FormEvent) => void; submitting: boolean; editingAlertId: string | null; editThreshold: number; startEditing: (alert: Alert) => void; setEditThreshold: (value: number) => void; updateAlert: (alert: Alert, changes: { thresholdPercent?: number; is_active?: boolean }) => void; deactivateAlert: (alert: Alert) => void }) {
  return <><SectionHeading eyebrow="Configuración" title="Campos y alertas" description="Organizá tus lotes y definí desde qué probabilidad querés recibir una notificación." /><div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]"><div className="space-y-6"><form onSubmit={createField} className="panel"><p className="panel-kicker">Nuevo campo</p><h2 className="panel-title mt-1">Sumar un lote</h2><label className="form-label" htmlFor="field-name">Nombre del campo</label><input id="field-name" value={newFieldName} onChange={(event) => setNewFieldName(event.target.value)} required maxLength={120} placeholder="Ej. Lote Norte" className="form-input" /><button disabled={submitting} className="primary-button mt-4 w-full">Crear campo</button></form><form onSubmit={createAlert} className="panel"><p className="panel-kicker">Nueva regla</p><h2 className="panel-title mt-1">Configurar alerta</h2>{fields.length ? <><label className="form-label" htmlFor="alert-field">Campo</label><select id="alert-field" value={alertFieldId} onChange={(event) => setAlertFieldId(event.target.value)} className="form-input">{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select><label className="form-label" htmlFor="alert-event">Evento</label><select id="alert-event" value={alertEvent} onChange={(event) => setAlertEvent(event.target.value as WeatherEvent)} className="form-input">{Object.entries(eventMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select><div className="mt-4 flex items-center justify-between"><label className="text-sm font-medium" htmlFor="alert-threshold">Umbral</label><strong className="rounded-lg bg-[#e4ece2] px-2.5 py-1 text-sm text-[#285b3b]">{alertThreshold}%</strong></div><input id="alert-threshold" type="range" min="1" max="100" value={alertThreshold} onChange={(event) => setAlertThreshold(Number(event.target.value))} className="mt-3 w-full accent-[#28613e]" /><button disabled={submitting} className="primary-button mt-5 w-full">Activar alerta</button></> : <p className="mt-4 rounded-xl bg-[#f2f3ee] p-4 text-sm leading-6 text-[#68736b]">Primero creá un campo para poder asociarle una alerta.</p>}</form></div><div className="panel"><div className="panel-heading"><div><p className="panel-kicker">Inventario</p><h2 className="panel-title">Campos registrados</h2></div><span className="count-pill">{fields.length}</span></div>{fields.length ? <div className="space-y-4">{fields.map((field) => { const fieldAlerts = alerts.filter((alert) => alert.field_id === field.id); return <div key={field.id} className="rounded-2xl border border-[#dfe4dc] bg-[#fafbf8] p-4"><div className="mb-4 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#dfeadf] text-[#2b6040]">◫</span><div className="flex-1"><h3 className="font-semibold">{field.name}</h3><p className="text-xs text-[#758077]">{fieldAlerts.length} {fieldAlerts.length === 1 ? 'alerta configurada' : 'alertas configuradas'}</p></div></div>{fieldAlerts.length ? <div className="space-y-2">{fieldAlerts.map((alert) => { const meta = eventMeta[alert.event_type]; return <div key={alert.id} className={`rounded-xl border p-3 ${alert.is_active ? 'border-[#dce3da] bg-white' : 'border-[#e4e4e0] bg-[#f4f4f1] opacity-70'}`}><div className="flex flex-wrap items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-lg text-lg ${meta.tone}`}>{meta.symbol}</span><div className="min-w-28 flex-1"><p className="text-sm font-semibold">{meta.label}</p><p className="text-xs text-[#737e76]">{alert.is_active ? 'Activa' : 'Desactivada'} · umbral {toPercentage(alert.threshold)}%</p></div>{editingAlertId === alert.id ? <div className="flex items-center gap-2"><input aria-label={`Nuevo umbral para ${meta.label}`} type="number" min="1" max="100" value={editThreshold} onChange={(event) => setEditThreshold(Number(event.target.value))} className="w-20 rounded-lg border border-[#cfd6cd] px-2 py-1.5 text-sm" /><button onClick={() => updateAlert(alert, { thresholdPercent: editThreshold })} className="small-button">Guardar</button></div> : <><button onClick={() => startEditing(alert)} className="small-button">Editar</button>{alert.is_active ? <button onClick={() => deactivateAlert(alert)} className="small-button danger">Desactivar</button> : <button onClick={() => updateAlert(alert, { is_active: true })} className="small-button">Reactivar</button>}</>}</div></div>; })}</div> : <p className="rounded-xl border border-dashed border-[#d7ddd4] p-3 text-center text-xs text-[#7a847d]">Sin alertas para este campo.</p>}</div>; })}</div> : <EmptyState symbol="◫" title="No hay campos registrados" text="Usá el formulario para sumar tu primer lote." />}</div></div></>;
}

function NotificationsView({ notifications, unreadOnly, setUnreadOnly, markRead, fieldById, alertById, refresh }: { notifications: Notification[]; unreadOnly: boolean; setUnreadOnly: (value: boolean) => void; markRead: (notification: Notification) => void; fieldById: Record<string, FarmField>; alertById: Record<string, Alert>; refresh: () => void }) {
  return <><SectionHeading eyebrow="Seguimiento" title="Notificaciones" description="Cada aviso conserva la probabilidad y el umbral exactos que lo dispararon." /><div className="panel"><div className="panel-heading flex-wrap"><div className="flex items-center gap-2 rounded-xl bg-[#f0f2ed] p-1"><button onClick={() => setUnreadOnly(false)} className={`filter-button ${!unreadOnly ? 'active' : ''}`}>Todas</button><button onClick={() => setUnreadOnly(true)} className={`filter-button ${unreadOnly ? 'active' : ''}`}>Sin leer</button></div><button onClick={refresh} className="small-button">↻ Actualizar</button></div>{notifications.length ? <div className="divide-y divide-[#e4e7e1]">{notifications.map((notification) => <div key={notification.id} className="py-1"><NotificationRow notification={notification} field={fieldById[alertById[notification.alert_id]?.field_id]} onRead={() => markRead(notification)} /></div>)}</div> : <EmptyState symbol="✓" title={unreadOnly ? 'No quedan avisos sin leer' : 'Todavía no hay notificaciones'} text="Cuando un pronóstico supere un umbral, aparecerá automáticamente en esta lista." />}</div><p className="mt-3 text-center text-xs text-[#7b857e]">Esta vista se actualiza automáticamente cada 5 segundos.</p></>;
}

function NotificationRow({ notification, field, onRead, compact = false }: { notification: Notification; field?: FarmField; onRead?: () => void; compact?: boolean }) {
  const meta = eventMeta[notification.event_type];
  return <div className={`flex items-start gap-3 ${compact ? 'py-4' : 'py-5'}`}><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl ${meta.tone}`}>{meta.symbol}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{meta.label} en {field?.name || 'campo'}</h3>{!notification.read_at && <span className="rounded-full bg-[#f1ddd5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#a34e35]">Nueva</span>}</div><p className="mt-1 text-xs leading-5 text-[#68746b]">Probabilidad <strong>{toPercentage(notification.probability)}%</strong> · umbral {toPercentage(notification.threshold)}% · {formatDate(notification.forecast_date)}</p></div>{onRead && !notification.read_at && <button onClick={onRead} className="small-button shrink-0">Marcar leída</button>}</div>;
}

function DemoView({ fields, internalToken, setInternalToken, forecastFieldId, setForecastFieldId, forecastEvent, setForecastEvent, forecastDate, setForecastDate, probability, setProbability, submit, submitting }: { fields: FarmField[]; internalToken: string; setInternalToken: (value: string) => void; forecastFieldId: string; setForecastFieldId: (value: string) => void; forecastEvent: WeatherEvent; setForecastEvent: (value: WeatherEvent) => void; forecastDate: string; setForecastDate: (value: string) => void; probability: number; setProbability: (value: number) => void; submit: (event: FormEvent) => void; submitting: boolean }) {
  return <><SectionHeading eyebrow="Herramienta técnica" title="Clima demo" description="Simulá la información que normalmente escribiría el job de ingesta meteorológica." /><div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]"><form onSubmit={submit} className="panel"><div className="mb-5 rounded-xl border border-[#ecd7ae] bg-[#fff8e8] p-4"><p className="text-sm font-semibold text-[#805a24]">Entorno de demostración</p><p className="mt-1 text-xs leading-5 text-[#8a704b]">Este formulario usa el endpoint interno. El token se mantiene sólo en memoria y se pierde al recargar.</p></div><label className="form-label" htmlFor="internal-token">Token interno</label><input id="internal-token" type="password" autoComplete="off" value={internalToken} onChange={(event) => setInternalToken(event.target.value)} required placeholder="Ingresá INTERNAL_API_TOKEN" className="form-input" />{fields.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><label className="form-label mt-0" htmlFor="forecast-field">Campo</label><select id="forecast-field" value={forecastFieldId} onChange={(event) => setForecastFieldId(event.target.value)} className="form-input">{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></div><div><label className="form-label mt-0" htmlFor="forecast-event">Evento</label><select id="forecast-event" value={forecastEvent} onChange={(event) => setForecastEvent(event.target.value as WeatherEvent)} className="form-input">{Object.entries(eventMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></div><div><label className="form-label mt-0" htmlFor="forecast-date">Fecha</label><input id="forecast-date" type="date" min={new Date().toISOString().slice(0, 10)} value={forecastDate} onChange={(event) => setForecastDate(event.target.value)} className="form-input" /></div><div><label className="form-label mt-0" htmlFor="forecast-probability">Probabilidad (%)</label><input id="forecast-probability" type="number" min="0" max="100" value={probability} onChange={(event) => setProbability(Number(event.target.value))} className="form-input" /></div></div> : <p className="mt-5 rounded-xl bg-[#f2f3ee] p-4 text-sm text-[#68736b]">Creá un campo antes de cargar un pronóstico.</p>}<button disabled={submitting || !fields.length} className="primary-button mt-6 w-full">Guardar pronóstico</button></form><div className="panel h-fit"><p className="panel-kicker">Cómo probarlo</p><h2 className="panel-title mt-1">Del pronóstico al aviso</h2><ol className="mt-5 space-y-5">{['Configurá una alerta para el campo y evento elegidos.', 'Cargá una probabilidad igual o mayor al umbral.', 'Esperá hasta 10 segundos y abrí Notificaciones.'].map((step, index) => <li key={step} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dfe9dd] text-xs font-bold text-[#2c6040]">{index + 1}</span><p className="pt-1 text-sm leading-5 text-[#667269]">{step}</p></li>)}</ol><div className="mt-6 rounded-xl bg-[#eef2eb] p-4 text-xs leading-5 text-[#657168]">La restricción única de PostgreSQL garantiza que varias evaluaciones produzcan una sola notificación.</div></div></div></>;
}

function EmptyState({ symbol, title, text, action, onAction }: { symbol: string; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="grid min-h-52 place-items-center px-4 py-8 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e8eee5] text-xl text-[#3d684a]">{symbol}</span><h3 className="mt-4 font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#737e76]">{text}</p>{action && <button onClick={onAction} className="text-link mt-4">{action} →</button>}</div></div>;
}
