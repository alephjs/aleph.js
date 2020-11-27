import { assertEquals } from 'https://deno.land/std@0.79.0/testing/asserts.ts'
import { Routing } from '../routing.ts'

const routing = new Routing([], '/', 'en', ['en', 'zh-CN'])

Deno.test(`router #01`, () => {
    routing.update({ id: '/pages/index.js', hash: '' })
    routing.update({ id: '/pages/blog/index.js', hash: '' })
    routing.update({ id: '/pages/blog/[slug].js', hash: '' })
    routing.update({ id: '/pages/user/index.js', hash: '' })
    routing.update({ id: '/pages/user/[...all].js', hash: '' })
    routing.update({ id: '/pages/blog.js', hash: '' })
    routing.update({ id: '/pages/user.js', hash: '' })
    routing.update({ id: '/pages/blog/[slug]/subpage.js', hash: '' })
    routing.update({ id: '/pages/docs.js', hash: '' })
    routing.update({ id: '/pages/docs/get-started.md', hash: '' })
    routing.update({ id: '/pages/docs/installation.md', hash: '' })
    routing.update({ id: '/pages/index.js', hash: 'hsidfshy3yhfya49848' })
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

Deno.test(`router #02`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/')
    assertEquals(router.pagePath, '/')
    assertEquals(tree, [{ id: '/pages/index.js', hash: 'hsidfshy3yhfya49848' }])
})

Deno.test(`router #03`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/zh-CN' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/')
    assertEquals(router.pagePath, '/')
    assertEquals(tree, [{ id: '/pages/index.js', hash: 'hsidfshy3yhfya49848' }])
})

Deno.test(`router #04`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/blog' })
    assertEquals(router.locale, 'en')
    assertEquals(router.pathname, '/blog')
    assertEquals(router.pagePath, '/blog')
    assertEquals(tree.map(({ id }) => id), ['/pages/blog.js', '/pages/blog/index.js'])
})

Deno.test(`router #05`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/zh-CN/blog' })
    assertEquals(router.locale, 'zh-CN')
    assertEquals(router.pathname, '/blog')
    assertEquals(router.pagePath, '/blog')
    assertEquals(tree.map(({ id }) => id), ['/pages/blog.js', '/pages/blog/index.js'])
})

Deno.test(`router #06`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/blog/hello-world' })
    assertEquals(router.pathname, '/blog/hello-world')
    assertEquals(router.pagePath, '/blog/[slug]')
    assertEquals(router.params, { slug: 'hello-world' })
    assertEquals(tree.map(({ id }) => id), ['/pages/blog.js', '/pages/blog/[slug].js'])
})

Deno.test(`router #07`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user' })
    assertEquals(router.pathname, '/user')
    assertEquals(router.pagePath, '/user')
    assertEquals(router.params, {})
    assertEquals(tree.map(({ id }) => id), ['/pages/user.js', '/pages/user/index.js'])
})

Deno.test(`router #08`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user/projects' })
    assertEquals(router.pathname, '/user/projects')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'projects' })
    assertEquals(tree.map(({ id }) => id), ['/pages/user.js', '/pages/user/[...all].js'])
})

Deno.test(`router #09`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user/settings/profile' })
    assertEquals(router.pathname, '/user/settings/profile')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'settings/profile' })
    assertEquals(tree.map(({ id }) => id), ['/pages/user.js', '/pages/user/[...all].js'])
})

Deno.test(`router #10`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/user/settings/security' })
    assertEquals(router.pathname, '/user/settings/security')
    assertEquals(router.pagePath, '/user/[...all]')
    assertEquals(router.params, { all: 'settings/security' })
    assertEquals(tree.map(({ id }) => id), ['/pages/user.js', '/pages/user/[...all].js'])
})

Deno.test(`router #11`, () => {
    const [router, tree] = routing.createRouter({ pathname: '/null' })
    assertEquals(router.pathname, '/null')
    assertEquals(router.pagePath, '')
    assertEquals(router.params, {})
    assertEquals(tree, [])
})
