import unittest
from unittest.mock import patch
from link_preview import PreviewParser, fetch_link_preview


class LinkPreviewTests(unittest.TestCase):
    def test_open_graph_and_relative_image(self):
        parser = PreviewParser()
        parser.feed('<title>Webpage &amp; Code</title><meta property="og:title" content="Social title">'
                    '<meta name="description" content="A short description">'
                    '<meta property="og:image" content="/social.png">'
                    '<img src="/first.png"><img src="/second.png">')
        result = parser.result('https://example.com/article')
        self.assertEqual(result['title'], 'Webpage & Code')
        self.assertEqual(result['description'], 'A short description')
        self.assertEqual(result['image'], 'https://example.com/first.png')

    def test_lazy_first_image_and_base_url(self):
        parser = PreviewParser()
        parser.feed('<base href="/assets/"><img src="data:image/gif;base64,AA" data-src="first.jpg">'
                    '<img src="second.jpg">')
        self.assertEqual(parser.result('https://example.com/article')['image'],
                         'https://example.com/assets/first.jpg')

    def test_social_image_is_not_used_as_page_image(self):
        parser = PreviewParser()
        parser.feed('<meta property="og:title" content="Page title">'
                    '<meta property="og:image" content="/social.png">')
        result = parser.result('https://example.com')
        self.assertEqual(result['title'], 'Page title')
        self.assertEqual(result['image'], '')

    def test_fallback_and_unsafe_image(self):
        parser = PreviewParser()
        parser.feed('<title>  Plain title </title><meta property="og:image" content="javascript:alert(1)">')
        self.assertEqual(parser.result('https://example.com')['title'], 'Plain title')
        self.assertEqual(parser.result('https://example.com')['image'], '')

    def test_pdf_does_not_download_document(self):
        with patch('link_preview.urllib.request.urlopen') as fetch:
            result = fetch_link_preview('https://example.com/paper.pdf?download=1')
        fetch.assert_not_called()
        self.assertEqual(result['title'], 'paper.pdf')

    def test_invalid_protocol(self):
        with self.assertRaises(ValueError):
            fetch_link_preview('file:///local')


if __name__ == '__main__':
    unittest.main()
