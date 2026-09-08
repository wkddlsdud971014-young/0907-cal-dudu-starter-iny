import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env as Record<string, string>).VITE_SUPABASE_URL;
const supabaseKey = (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export async function submitRequestRPC(
  customerId: string,
  slotIds: string[],
  operationId: string
) {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.rpc('submit_request', {
    p_customer_id: customerId,
    p_slot_ids: slotIds,
    p_operation_id: operationId,
  });

  if (error) throw error;
  return data;
}

export async function confirmRequestRPC(
  requestId: string,
  slotId: string,
  adminId: string,
  operationId: string
) {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.rpc('confirm_request', {
    p_request_id: requestId,
    p_slot_id: slotId,
    p_admin_id: adminId,
    p_operation_id: operationId,
  });

  if (error) throw error;
  return data;
}

export async function resubmitRequestRPC(
  customerId: string,
  requestId: string,
  slotIds: string[],
  operationId: string
) {
  if (!supabase) throw new Error('Supabase not initialized');

  // 인자 이름은 SQL 함수 시그니처와 정확히 일치해야 한다.
  // PostgREST가 이름으로 오버로드를 찾기 때문에, 다르면 PGRST202로 함수를 못 찾는다.
  const { data, error } = await supabase.rpc('resubmit_request', {
    p_customer_id: customerId,
    p_request_id: requestId,
    p_slot_ids: slotIds,
    p_operation_id: operationId,
  });

  if (error) throw error;
  return data;
}

export async function getSlots() {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .order('date', { ascending: true })
    .order('time_label', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getRequests() {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase
    .from('requests')
    .select('*, candidates(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getCurrentUser() {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

// 배포판 방문자용 입구. 이메일·비밀번호 없이 각자 uid 를 받는다.
//
// 계정을 하나로 공유하면 "고객당 신청 하나" 규칙 때문에 먼저 들어온 사람의 신청을
// 다음 사람이 자기 것으로 보게 된다. 익명 로그인은 사람마다 uid 가 달라서
// 기존 RLS(customer_id = auth.uid())가 그대로 각자를 갈라준다.
//
// 익명 사용자도 JWT 의 role 은 authenticated 다. 그래서 정책과 RPC 권한을 고치지 않는다.
// app_metadata 는 비어 있으므로 어드민이 될 수 없다.
// Supabase 대시보드에서 Authentication → Sign In / Providers → Anonymous sign-ins 를 켜야 한다.
export async function signInAnonymously() {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) throw error;
  return data;
}

export async function getSession() {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// 저장해 둔 토큰으로 로그인 상태를 되살린다.
//
// 익명 참여자는 비밀번호가 없어서 한 번 로그아웃하면 다시 들어갈 방법이 없다.
// 그런데 혼자서 「신청 → 어드민 확정 → 고객이 결과 확인」을 돌려보려면
// 중간에 어드민으로 갈아탔다가 원래 참여자로 돌아와야 한다.
// 그래서 로그아웃 전에 토큰을 남겨 두고 이 함수로 되돌아온다.
export async function restoreSession(tokens: {
  access_token: string;
  refresh_token: string;
}) {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.auth.setSession(tokens);
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) throw new Error('Supabase not initialized');

  // scope: 'local' 은 이 브라우저의 세션만 지우고 refresh token 을 서버에서
  // 폐기하지 않는다. 기본값(global)으로 지우면 남겨 둔 토큰까지 무효가 되어
  // restoreSession 으로 되돌아올 수 없다.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}
