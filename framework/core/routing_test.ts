import { assertEquals } from 'https://deno.land/std@0.85.0/testing/asserts.ts'
import { Routing } from './routing.ts'

Deno.test(`routing`, () => {
  const routing = new Routing({
    locales: ['en', 'zh-CN'],
    rewrites: {
      '/Hello World': '/hello-world',
      '/你好世界': '/zh-CN/hello-world',
    }
  })
  routing.update({ url: '/pages/index.tsx', hash: '' })
  routing.update({ url: '/pages/hello-world.tsx', hash: '' })
  routing.update({ url: '/pages/blog/index.tsx', hash: '' })
  routing.update({ url: '/pages/blog/[slug].tsx', hash: '' })
  routing.update({ url: '/pages/user/index.tsx', hash: '' })
  routing.update({ url: '/pages/user/[...all].tsx', hash: '' })
  routing.update({ url: '/pages/blog.tsx', hash: '' })
  routing.update({ url: '/pages/user.tsx', hash: '' })
  routing.update({ url: '/pages/blog/[slug]/subpage.tsx', hash: '' })
  routing.update({ url: '/pages/docs.tsx', hash: '' })
  routing.update({ url: '/pages/docs/get-started.tsx', hash: '' })
  routing.update({ url: '/pages/docs/installation.tsx', hash: '' })
  routing.update({ url: '/pages/index.tsx', hash: 'hsidfshy3yhfya49848' })

  assertEquals(routing.paths, [
    '/',
    '/hello-world',
    '/blog',
    '/user',
    '/docs',
    '/blog/[slug]',
    '/blog/[slug]/subpage',
    '/user/[...all]',
    '/docs/get-started',
    '/docs/installation',
  ])

  {
    const [router, chain] = routing.createRouter({ pathname: '/' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/')
    assertEquals(router.pagePath, '/')
    assertEquals(chain, [{ url: '/pages/index.tsx', hash: 'hsidfshy3yhfya49848' }])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/zh-CN' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/')
    assertEquals(router.pagePath, '/')
    assertEquals(chain, [{ url: '/pages/index.tsx', hash: 'hsidfshy3yhfya49848' }])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/Hello World' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/hello-world')
    assertEquals(router.pagePath, '/hello-world')
    assertEquals(chain, [{ url: '/pages/hello-world.tsx', hash: '' }])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/你好世界' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/hello-world')
    assertEquals(router.pagePath, '/hello-world')
    assertEquals(chain, [{ url: '/pages/hello-world.tsx', hash: '' }])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/blog' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/blog')
    assertEquals(router.pagePath, '/blog')
    assertEquals(chain.map(({ url }) => url), ['/pages/blog.tsx', '/pages/blog/index.tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/zh-CN/blog' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/blog')
    assertEquals(router.pagePath, '/blog')
    assertEquals(chain.map(({ url }) => url), ['/pages/blog.tsx', '/pages/blog/index.tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/blog/hello-world' })
    assertEquals(router.pathname, '/blog/hello-world')
    assertEquals(router.pagePath, '/blog/[slug]')
    assertEquals(router.params, { slug: 'hello-world' })
    assertEquals(chain.map(({ url }) => url), ['/pages/blog.tsx', '/pages/blog/[slug].tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/user' })
    assertEquals(router.pathname, '/user')
    assertEquals(router.pagePath, '/user')
    assertEquals(router.params, {})
    assertEquals(chain.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/index.tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/user/projects' })
    assertEquals(router.pathname, '/user/projects')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'projects' })
    assertEquals(chain.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/[...all].tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/user/settings/profile' })
    assertEquals(router.pathname, '/user/settings/profile')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'settings/profile' })
    assertEquals(chain.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/[...all].tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/user/settings/security' })
    assertEquals(router.pathname, '/user/settings/security')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'settings/security' })
    assertEquals(chain.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/[...all].tsx'])
  }

  {
    const [router, chain] = routing.createRouter({ pathname: '/null' })
    assertEquals(router.pathname, '/null')
    assertEquals(router.pagePath, '')
    assertEquals(router.params, {})
    assertEquals(chain, [])
  }
})
