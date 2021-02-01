import { assertEquals } from 'https://deno.land/std@0.85.0/testing/asserts.ts'

const routing = new Routing([], '/', 'en', ['en', 'zh-CN'])

Deno.test(`routing #01`, () => {
    routing.update({ url: '/pages/index.tsx', hash: '' })
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
        '/blog',
        '/user',
        '/docs',
        '/blog/[slug]',
        '/blog/[slug]/subpage',
        '/user/[...all]',
        '/docs/get-started',
        '/docs/installation',
    ])
})

Deno.test(`routing #02`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/')
    assertEquals(router.pagePath, '/')
    assertEquals(tree, [{ url: '/pages/index.tsx', hash: 'hsidfshy3yhfya49848' }])
})

Deno.test(`routing #03`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/zh-CN' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/')
    assertEquals(router.pagePath, '/')
    assertEquals(tree, [{ url: '/pages/index.tsx', hash: 'hsidfshy3yhfya49848' }])
})

Deno.test(`routing #04`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/blog' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/blog')
    assertEquals(router.pagePath, '/blog')
    assertEquals(tree.map(({ url }) => url), ['/pages/blog.tsx', '/pages/blog/index.tsx'])
})

Deno.test(`routing #05`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/zh-CN/blog' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/blog')
    assertEquals(router.pagePath, '/blog')
    assertEquals(tree.map(({ url }) => url), ['/pages/blog.tsx', '/pages/blog/index.tsx'])
})

Deno.test(`routing #06`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/blog/hello-world' })
    assertEquals(router.pathname, '/blog/hello-world')
    assertEquals(router.pagePath, '/blog/[slug]')
    assertEquals(router.params, { slug: 'hello-world' })
    assertEquals(tree.map(({ url }) => url), ['/pages/blog.tsx', '/pages/blog/[slug].tsx'])
})

Deno.test(`routing #07`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user' })
    assertEquals(router.pathname, '/user')
    assertEquals(router.pagePath, '/user')
    assertEquals(router.params, {})
    assertEquals(tree.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/index.tsx'])
})

Deno.test(`routing #08`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user/projects' })
    assertEquals(router.pathname, '/user/projects')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'projects' })
    assertEquals(tree.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/[...all].tsx'])
})

Deno.test(`routing #09`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user/settings/profile' })
    assertEquals(router.pathname, '/user/settings/profile')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'settings/profile' })
    assertEquals(tree.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/[...all].tsx'])
})

Deno.test(`routing #10`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user/settings/security' })
    assertEquals(router.pathname, '/user/settings/security')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'settings/security' })
    assertEquals(tree.map(({ url }) => url), ['/pages/user.tsx', '/pages/user/[...all].tsx'])
})

Deno.test(`routing #11`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/null' })
    assertEquals(router.pathname, '/null')
    assertEquals(router.pagePath, '')
    assertEquals(router.params, {})
    assertEquals(tree, [])
})
