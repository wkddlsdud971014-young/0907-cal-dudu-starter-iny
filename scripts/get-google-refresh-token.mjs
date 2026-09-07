// 구글 refresh token 을 한 번만 받아오는 도우미.
// 운영자 계정으로 동의하면 그 결과를 Edge Function 비밀값으로 넣는다.
// Node 기본 기능만 쓴다. 설치할 것 없다.
//
// 쓰는 법:
//   node scripts/get-google-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
//
// 미리 할 일: 구글 클라우드 OAuth 클라이언트의 "승인된 리디렉션 URI" 에
//   http://localhost:5190/callback
// 를 넣어두어야 한다.

import http from 'node:http';
import { URL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const [, , clientId, clientSecret] = process.argv;

if (!clientId || !clientSecret) {
  console.error('사용법: node scripts/get-google-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const PORT = 5190;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
// 일정 생성만 필요하다. 캘린더 전체 권한은 요구하지 않는다.
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    // refresh token 은 offline + consent 를 줘야 내려온다.
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

console.log('\n아래 주소를 브라우저에 붙여넣고 운영자 계정으로 동의하세요.\n');
console.log(authUrl);
console.log('\n동의가 끝나면 이 창에 결과가 나옵니다. 기다리는 중...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not found');
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`실패: ${error}`);
    console.error('동의 실패:', error);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const token = await tokenRes.json();

  if (!tokenRes.ok || !token.refresh_token) {
    res
      .writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('refresh token 을 못 받았습니다. 터미널을 보세요.');
    console.error('\n실패:', JSON.stringify(token, null, 2));
    console.error(
      '\nrefresh_token 이 없으면 대개 이전에 이미 동의한 계정입니다.',
      '\nhttps://myaccount.google.com/permissions 에서 이 앱 접근을 지우고 다시 실행하세요.'
    );
    server.close();
    process.exit(1);
  }

  res
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end('<h3>완료되었습니다. 터미널로 돌아가세요.</h3>');

  // 토큰을 화면에 찍지 않는다. 로그·화면 캡처·대화 기록에 남으면 안 되는 값이라
  // 곧바로 secrets.local.sh 에 써 넣는다.
  const target = 'scripts/secrets.local.sh';
  try {
    const current = await readFile(target, 'utf8');
    const patched = current.replace(
      /^GOOGLE_REFRESH_TOKEN=.*$/m,
      `GOOGLE_REFRESH_TOKEN='${token.refresh_token}'`
    );
    if (patched === current) {
      throw new Error('GOOGLE_REFRESH_TOKEN 줄을 찾지 못했습니다');
    }
    await writeFile(target, patched);
    console.log(`성공. ${target} 의 GOOGLE_REFRESH_TOKEN 을 채웠습니다.`);
    console.log(`(길이 ${token.refresh_token.length}자, 화면에는 찍지 않습니다)\n`);
    console.log('다음: sh scripts/secrets.local.sh\n');
  } catch (e) {
    console.error(`\n${target} 에 쓰지 못했습니다: ${e.message}`);
    console.error('먼저 아래를 실행해 파일을 만든 뒤 다시 시도하세요.');
    console.error('  cp scripts/set-secrets.example.sh scripts/secrets.local.sh\n');
    server.close();
    process.exit(1);
  }

  server.close();
  process.exit(0);
});

server.listen(PORT);
