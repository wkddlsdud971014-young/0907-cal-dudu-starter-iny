import React, { useState, useEffect } from 'react';
import { CustomerPage } from '../components/CustomerPage';
import { AdminPage } from '../components/AdminPage';
import { DatabaseManager } from '../utils/database';
import { REFERENCE_TIME } from '../utils/constants';
import { supabase, signInWithPassword, signOut, getCurrentUser } from '../utils/supabase';

type Mode = 'local' | 'supabase';
type Role = 'customer' | 'admin';

const App: React.FC = () => {
  const [mode] = useState<Mode>(() => {
    const supabaseUrl = (import.meta.env as Record<string, string>).VITE_SUPABASE_URL;
    const supabaseKey = (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY;
    return (supabaseUrl && supabaseKey && supabaseUrl !== 'https://your-project.supabase.co') ? 'supabase' : 'local';
  });

  const [role, setRole] = useState<Role>('customer');
  const [db] = useState(() => new DatabaseManager());

  // Supabase 모드 상태
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'customer' | 'admin' | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState('');

  // Supabase 모드일 때 사용자 상태 확인
  useEffect(() => {
    if (mode === 'supabase' && supabase) {
      checkUser();

      const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          setUser(session.user);
          const role = session.user.user_metadata?.role || 'customer';
          setUserRole(role);
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
          const role = user.user_metadata?.role || 'customer';
          setUserRole(role);
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
      const role = result.user.user_metadata?.role || 'customer';
      setUserRole(role);
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      setError(err.message || '로그인 실패');
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

        <div className="alert alert-info">
          <strong>Supabase 모드:</strong> 실제 데이터베이스와 인증이 적용됩니다.
        </div>

        <div style={{ maxWidth: '400px', margin: '60px auto', padding: '40px', background: 'white', border: '1px solid #ddd', borderRadius: '4px' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '30px' }}>로그인</h2>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSupabaseLogin}>
            <div className="form-group">
              <label>이메일</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="customer1@test.com"
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
                placeholder="Test123456!"
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

          <div style={{ marginTop: '20px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
            <p><strong>테스트 계정:</strong></p>
            <p>고객: customer1@test.com / Test123456!</p>
            <p>어드민: admin@test.com / Admin123456!</p>
          </div>
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
            <span style={{ fontSize: '14px', color: '#666' }}>
              {user.email} ({userRole === 'admin' ? '어드민' : '고객'})
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

        <div className="alert alert-info">
          <strong>Supabase 모드:</strong> 실제 데이터베이스와 인증이 적용됩니다.
        </div>

        {userRole === 'customer' && <CustomerPage db={db} mode={mode} />}
        {userRole === 'admin' && <AdminPage db={db} mode={mode} />}

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

      {role === 'customer' && <CustomerPage db={db} mode={mode} />}
      {role === 'admin' && <AdminPage db={db} mode={mode} />}

      <hr style={{ margin: '40px 0', borderColor: '#ddd' }} />
      <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', paddingBottom: '20px' }}>
        <p>cal.dudu-works.com v1.0 - 수업용 기본 실습 앱</p>
        <p>기본값: 42슬롯(14일 × 3시간대), 고객 1-3개 희망, 어드민 수동 확정</p>
      </div>
    </div>
  );
};

export default App;
