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
  previousRequestId: string,
  newSlotIds: string[],
  operationId: string
) {
  if (!supabase) throw new Error('Supabase not initialized');

  const { data, error } = await supabase.rpc('resubmit_request', {
    p_customer_id: customerId,
    p_previous_request_id: previousRequestId,
    p_new_slot_ids: newSlotIds,
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
    .order('date,time_label');

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

export async function signOut() {
  if (!supabase) throw new Error('Supabase not initialized');

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
