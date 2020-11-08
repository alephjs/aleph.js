import { Import, useDeno } from 'https://deno.land/x/aleph/mod.ts'
import React, { useState } from 'https://esm.sh/react'
import Logo from '../components/logo.tsx'
import useSWR from "https://esm.sh/swr"
import Axios from "https://esm.sh/axios";

const fetcher = (url: string) => Axios.get(url).then(({ data }) => data);

export default function Home() {
    const { data } = useSWR('/api/hi', fetcher);

    if (!data) {
        return <div>loading...</div>
    }
    return <div>hello {data.name}!</div>
}
