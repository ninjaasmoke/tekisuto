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

const IndexPage: React.FC = () => {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();

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
        placeholder="Enter text content"
      />
      <button onClick={saveFile} disabled={!text}>Save</button>
    </div>
  );
};

export default IndexPage;
