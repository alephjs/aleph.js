import { assertEquals } from 'https://deno.land/std@0.88.0/testing/asserts.ts'
import { toLocalUrl } from './helper.ts'

Deno.test(`server/helper`, async () => {
  // test toLocalUrl()
  {
    assertEquals(toLocalUrl('https://esm.sh/react@17.0.1'), '/-/esm.sh/react@17.0.1')
    assertEquals(toLocalUrl('https://esm.sh:443/react@17.0.1'), '/-/esm.sh/react@17.0.1')
    assertEquals(toLocalUrl('https://esm.sh/react@17.0.1?dev'), `/-/esm.sh/[${btoa('dev').replace(/[+/=]/g, '')}]react@17.0.1`)
    assertEquals(toLocalUrl('https://esm.sh/react@17.0.1?target=es2015&dev'), `/-/esm.sh/[${btoa('target=es2015&dev').replace(/[+/=]/g, '')}]react@17.0.1`)
    assertEquals(toLocalUrl('http://localhost/mod.ts'), '/-/http_localhost/mod.ts')
    assertEquals(toLocalUrl('http://localhost:80/mod.ts'), '/-/http_localhost/mod.ts')
    assertEquals(toLocalUrl('http://localhost:8080/mod.ts'), '/-/http_localhost_8080/mod.ts')
    assertEquals(toLocalUrl('file:///mod.ts'), '/mod.ts')
  }
})
