import { useEffect, useState } from 'react';

import Head from 'next/head';

const LOGO = `%c
                                  
  ███╗   ██╗██╗████████╗██╗  ██╗  
  ████╗  ██║██║╚══██╔══╝██║  ██║  
  ██╔██╗ ██║██║   ██║   ███████║  
  ██║╚██╗██║██║   ██║   ██╔══██║  
  ██║ ╚████║██║   ██║   ██║  ██║  
  ╚═╝  ╚═══╝╚═╝   ╚═╝   ╚═╝  ╚═╝  
                                  
`

function parseJSONStrings(obj: any): any {
  if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        try {
          obj[key] = JSON.parse(obj[key]);
        } catch (error) {
          obj[key] = obj[key];
        }
      } else {
        obj[key] = parseJSONStrings(obj[key]);
      }
    }
  }
  return obj;
}


const IndexPage: React.FC = () => {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>('');

  useEffect(() => {
    console.log(LOGO, 'background: #000; color: #4caf50')
  }, [])


  const saveFile = () => {
    const element = document.createElement('a');
    const file = new Blob([text], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = fileName ? `${fileName}.txt` : "file.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const saveFileJson = () => {
    const json = JSON.parse(text);
    const parsedObject = JSON.stringify(parseJSONStrings(json));

    const element = document.createElement('a');
    const file = new Blob([parsedObject], { type: 'application/json' });
    element.href = URL.createObjectURL(file);
    element.download = fileName ? `${fileName}.json` : 'file.json';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const saveFileCSV = () => {
    let csv = '';
    text.split('\n').forEach((row) => {
      const values = row.split(',');
      const line = values.map((value) => `"${value}"`).join(',');
      csv += line + '\n';
    });

    const element = document.createElement('a');
    const file = new Blob([csv], { type: 'text/csv' });
    element.href = URL.createObjectURL(file);
    element.download = fileName ? `${fileName}.csv` : 'file.csv';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };



  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
  };

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFileName(event.target.value);
  };

  return (
    <div className='container'>
      <Head>
        <title>Text File Writer</title>
        <meta name="title" content="Text File Writer" />
        <meta name="description" content="simply, writes txt files" />

        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://tekisuto.nithin.cloud/" />
        <meta property="og:title" content="Text File Writer" />
        <meta property="og:description" content="simply, writes txt files" />
        <meta property="og:image" content="https://i.ibb.co/rcHrnWt/undraw-text-files-au1q.png" />

        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content="https://tekisuto.nithin.cloud/" />
        <meta property="twitter:title" content="Text File Writer" />
        <meta property="twitter:description" content="simply, writes txt files" />
        <meta property="twitter:image" content="https://i.ibb.co/rcHrnWt/undraw-text-files-au1q.png" />

        <meta name="theme-color" content="#efefef" />

      </Head>
      <input
        type="text"
        id="fileName"
        value={fileName}
        onChange={handleNameChange}
        placeholder="Enter file name"
      />
      <textarea
        id="textContent"
        value={text}
        onChange={handleInputChange}
        placeholder="Enter content"
      />
      <div className='buttons'>
        <button onClick={saveFile} disabled={!text}>Save</button>
        <button onClick={saveFileJson} disabled={!text}>Save as parsed JSON</button>
        <button onClick={saveFileCSV} disabled={!text}>Save as CSV</button>
      </div>
    </div>
  );
};

export default IndexPage;
