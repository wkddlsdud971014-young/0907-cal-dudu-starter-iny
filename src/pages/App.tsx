import React, { useState, useEffect } from 'react';
import { CustomerPage } from '../components/CustomerPage';
import { AdminPage } from '../components/AdminPage';
import { DatabaseManager } from '../utils/database';
import { REFERENCE_TIME } from '../utils/constants';
import { supabase, signInWithPassword, signInAnonymously, signOut, getCurrentUser } from '../utils/supabase';
import { createBackend } from '../utils/backend';

type Mode = 'local' | 'supabase';
type Role = 'customer' | 'admin';

// 어드민 판정은 app_metadata만 본다.
// user_metadata는 로그인한 사용자가 직접 고칠 수 있어 권한 근거로 쓰면 권한 상승이 된다.
// PRD "user_metadata를 권한으로 믿지 않습니다"와 SQL의 confirm_request·RLS 정책이 같은 기준이다.
function readRole(user: any): Role {
  return user?.app_metadata?.role === 'admin' ? 'admin' : 'customer';
}

const App: React.FC = () => {
  const [mode] = useState<Mode>(() => {
    const supabaseUrl = (import.meta.env as Record<string, string>).VITE_SUPABASE_URL;
    const supabaseKey = (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY;
    return (supabaseUrl && supabaseKey && supabaseUrl !== 'https://your-project.supabase.co') ? 'supabase' : 'local';
  });

  const [role, setRole] = useState<Role>('customer');
  const [db] = useState(() => new DatabaseManager());
  const [backend] = useState(() => createBackend(mode, db));
  // 로컬 모드에서만 손으로 바꾸는 값. Supabase 모드에서는 로그인 uid를 쓴다.
  const [customerId, setCustomerId] = useState('C01');

  // Supabase 모드 상태
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'customer' | 'admin' | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState('');
  // 배포판의 기본 입구는 익명 로그인이다. 운영자 로그인 폼은 접어두고 필요할 때만 편다.
  const [showOperatorLogin, setShowOperatorLogin] = useState(false);

  // Supabase 모드일 때 사용자 상태 확인
  useEffect(() => {
    if (mode === 'supabase' && supabase) {
      checkUser();

      const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          setUser(session.user);
          setUserRole(readRole(session.user));
        } else {
          setUser(null);
          setUserRole(null);
        }
      });

      return () => listener?.subscription.unsubscribe();
    }
  }, [mode]);

  const checkUser = async () => {
    try {
      if (supabase) {
        const user = await getCurrentUser();
        if (user) {
          setUser(user);
          setUserRole(readRole(user));
        }
      }
    } catch (err) {
      console.log('No user logged in');
    }
  };

  const handleSupabaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!supabase) throw new Error('Supabase not initialized');

      const result = await signInWithPassword(loginEmail, loginPassword);
      setUser(result.user);
      setUserRole(readRole(result.user));
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      setError(err.message || '로그인 실패');
    } finally {
      setLoading(false);
    }
  };

  // 계정 없이 바로 들어오는 입구. 사람마다 uid 가 달라 서로의 신청을 침범하지 않는다.
  const handleAnonymousStart = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await signInAnonymously();
      setUser(result.user);
      setUserRole(readRole(result.user));
    } catch (err: any) {
      setError(
        err?.message?.includes('disabled') || err?.status === 422
          ? '체험 입구가 아직 닫혀 있습니다. Supabase 대시보드에서 Anonymous sign-ins 를 켜야 합니다.'
          : err.message || '테스트 시작 실패'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSupabaseLogout = async () => {
    setLoading(true);
    try {
      await signOut();
      setUser(null);
      setUserRole(null);
    } catch (err: any) {
      setError(err.message || '로그아웃 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
  };

  const handleResetData = () => {
    if (window.confirm('모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      db.reset();
      window.location.reload();
    }
  };

  // Supabase 모드: 로그인 페이지
  if (mode === 'supabase' && !user) {
    return (
      <div className="container">
        <div className="header">
          <div>
            <h1>cal.dudu-works.com</h1>
            <div className="reference-time">
              기준 시각: {REFERENCE_TIME.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (고정)
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span className="mode-badge supabase">Supabase 모드</span>
          </div>
        </div>

        <div style={{ maxWidth: '400px', margin: '60px auto', padding: '40px', background: 'white', border: '1px solid #ddd', borderRadius: '4px' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>상담 예약 체험</h2>
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#666', marginTop: 0, marginBottom: '26px' }}>
            가입 없이 바로 써볼 수 있습니다.
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={handleAnonymousStart}
            disabled={loading}
          >
            {loading ? '준비 중...' : '테스트 시작'}
          </button>

          <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '14px', marginBottom: 0 }}>
            눌러서 들어오면 참여자마다 별도의 신청이 만들어집니다.
            같은 브라우저로 다시 오면 이어서 보이고, 로그아웃하면 새 참여자가 됩니다.
          </p>

          <hr style={{ margin: '26px 0 18px', border: 0, borderTop: '1px solid #eee' }} />

          {!showOperatorLogin ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '13px' }}
              onClick={() => setShowOperatorLogin(true)}
              disabled={loading}
            >
              운영자로 로그인
            </button>
          ) : (
            <form onSubmit={handleSupabaseLogin}>
              <div className="form-group">
                <label>이메일</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoComplete="username"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>비밀번호</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={loading}
              >
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Supabase 모드: 로그인됨
  if (mode === 'supabase' && user && userRole) {
    return (
      <div className="container">
        <div className="header">
          <div>
            <h1>cal.dudu-works.com</h1>
            <div className="reference-time">
              기준 시각: {REFERENCE_TIME.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (고정)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* 익명 참여자는 이메일이 없다. uid 앞자리로 서로를 구분하게 둔다. */}
            <span style={{ fontSize: '14px', color: '#666' }}>
              {user.email || `체험 ${String(user.id).slice(0, 8)}`} ({userRole === 'admin' ? '어드민' : '고객'})
            </span>
            <button
              className="btn btn-secondary"
              onClick={handleSupabaseLogout}
              style={{ padding: '6px 12px', fontSize: '12px' }}
              disabled={loading}
            >
              로그아웃
            </button>
            <span className="mode-badge supabase">Supabase 모드</span>
          </div>
        </div>

        {/* 모드 표시는 PRD 44행 요구사항이라 헤더의 배지로 유지한다.
            여기 있던 안내 바는 같은 말을 두 번 하는 것이라 뺐다. */}

        {/* Supabase 모드에서는 고객 코드 = 로그인 uid. RPC가 auth.uid()와 대조한다. */}
        {userRole === 'customer' && <CustomerPage backend={backend} customerId={user.id} />}
        {userRole === 'admin' && <AdminPage backend={backend} adminId={user.id} />}

        <hr style={{ margin: '40px 0', borderColor: '#ddd' }} />
        <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', paddingBottom: '20px' }}>
          <p>cal.dudu-works.com v1.0 - 수업용 기본 실습 앱</p>
          <p>기본값: 42슬롯(14일 × 3시간대), 고객 1-3개 희망, 어드민 수동 확정</p>
        </div>
      </div>
    );
  }

  // 로컬 모드
  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>cal.dudu-works.com</h1>
          <div className="reference-time">
            기준 시각: {REFERENCE_TIME.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (고정)
          </div>
        </div>

        <div className="role-selector">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', fontSize: '14px' }}>역할</span>
            <button
              className={`btn ${role === 'customer' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleRoleChange('customer')}
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              고객
            </button>
            <button
              className={`btn ${role === 'admin' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleRoleChange('admin')}
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              어드민
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: '20px' }}>
            <span className={`mode-badge ${mode}`}>{mode === 'local' ? '로컬 모드' : 'Supabase 모드'}</span>
            <button
              className="btn btn-secondary"
              onClick={handleResetData}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              데이터 초기화
            </button>
          </div>
        </div>
      </div>

      {mode === 'local' && (
        <div className="alert alert-info">
          <strong>로컬 모드:</strong> 브라우저 로컬 스토리지에 데이터를 저장합니다. 진짜 인증이 아닌 수업용 데모입니다.
          역할 전환은 이 모드에만 있습니다.
        </div>
      )}

      {role === 'customer' && (
        <CustomerPage
          backend={backend}
          customerId={customerId}
          onCustomerIdChange={setCustomerId}
        />
      )}
      {role === 'admin' && <AdminPage backend={backend} adminId="ADMIN001" />}

      <hr style={{ margin: '40px 0', borderColor: '#ddd' }} />
      <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', paddingBottom: '20px' }}>
        <p>cal.dudu-works.com v1.0 - 수업용 기본 실습 앱</p>
        <p>기본값: 42슬롯(14일 × 3시간대), 고객 1-3개 희망, 어드민 수동 확정</p>
      </div>
    </div>
  );
};

export default App;
