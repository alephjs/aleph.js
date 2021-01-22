import { assertEquals } from 'https://deno.land/std@0.83.0/testing/asserts.ts';
import { multiParser } from '../server/multiparser.ts';

const encoder = new TextEncoder();

const contentType = 'multipart/form-data; boundary=ALEPH-BOUNDARY';
const simpleString = '--ALEPH-BOUNDARY\rContent-Disposition: form-data; name="string_1"\r\n\r\nsimple string here\r--ALEPH-BOUNDARY--';
const complexString = 'some text to be ignored\r\r--ALEPH-BOUNDARY\rContent-Disposition: form-data; name="id"\r\n\r\n666\r--ALEPH-BOUNDARY\rContent-Disposition: form-data; name="title"\r\n\r\nHello World\r--ALEPH-BOUNDARY\rContent-Disposition: form-data; name="multiline"\r\n\r\nworld,\n hello\r--ALEPH-BOUNDARY\rContent-Disposition: form-data; name="file1"; filename="file_name.ext"\rContent-Type: video/mp2t\r\n\r\nsome random data\r--ALEPH-BOUNDARY--\rmore text to be ignored to be ignored\r';

Deno.test(`basic multiparser string`, async () => {
    const buff = new Deno.Buffer(encoder.encode(simpleString));
    const multiForm = await multiParser(buff, contentType);

    assertEquals(multiForm.get('string_1'), 'simple string here');
});

Deno.test(`complex multiparser string`, async () => {
    const buff = new Deno.Buffer(encoder.encode(complexString));
    const multiFrom = await multiParser(buff, contentType);

    // Asseting multiple string values
    assertEquals(multiFrom.get('id'), '666');
    assertEquals(multiFrom.get('title'), 'Hello World');
    assertEquals(multiFrom.get('multiline'), 'world,\n hello');

    // Asserting a file information
    const file = multiFrom.getFile('file1');
    if (!file) {
        return
    }

    assertEquals(file.name, 'file1');
    assertEquals(file.contentType, 'video/mp2t');
    assertEquals(file.size, 16);
});
