import React, { useRef, useEffect, useState } from 'react';
import { FileText, FilePlus, Image, Loader2, Menu, X, Globe2, Languages } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WebViewer from '@pdftron/webviewer';

function App() {
  const viewer = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [instance, setInstance] = useState<any>(null);
  const [ocrLang, setOcrLang] = useState('eng');
  const [translateSourceLang, setTranslateSourceLang] = useState('en');
  const [translateTargetLang, setTranslateTargetLang] = useState('fr');
  const [ocrText, setOcrText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showLangDialog, setShowLangDialog] = useState(false);
  const [showTranslateDialog, setShowTranslateDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (viewer.current) {
      WebViewer(
        {
          path: '/webviewer/lib',
          licenseKey: 'demo:1744368012314:613741310300000000e0217023d0dda15073f23b722b9372c9eae1788a',
          fullAPI: true,
          enableOfficeEditing: true,
          enableFilePicker: true
        },
        viewer.current
      ).then(async (core) => {
        setInstance(core);
        const { documentViewer, PDFNet } = core.Core;

        core.UI.setLanguage('en');
        core.UI.enableFeatures([core.UI.Feature.ContentEdit]);

        if (PDFNet) {
          PDFNet.initialize().then(async () => {
            console.log('✅ PDFNet initialized');
            // Create a new empty document by default
            try {
              const doc = await PDFNet.PDFDoc.create();
              await doc.initSecurityHandler();
              await doc.lock();
              const pageObj = await doc.pageCreate();
              await doc.pagePushBack(pageObj);
              const buffer = await doc.saveMemoryBuffer(PDFNet.SDFDoc.SaveOptions.e_linearized);
              const file = new File([new Uint8Array(buffer)], "new-document.pdf", { type: "application/pdf" });
              core.UI.loadDocument(file);
            } catch (error) {
              console.error("Error creating initial document:", error);
              showError("Failed to create initial document");
            }
          }).catch(err => {
            console.error('❌ PDFNet init error:', err);
            showError('Failed to initialize PDFNet');
          });
        }

        documentViewer.addEventListener('documentLoaded', () => {
          console.log('📄 Document loaded');
        });
      });
    }
  }, []);

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorDialog(true);
  };

  const splitTextIntoChunks = (text: string, maxBytes: number = 9000): string[] => {
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    const lines = text.split('\n');
    let currentChunk = '';
    
    for (const line of lines) {
      const potentialChunk = currentChunk + (currentChunk ? '\n' : '') + line;
      if (encoder.encode(potentialChunk).length > maxBytes) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          const words = line.split(' ');
          let lineChunk = '';
          for (const word of words) {
            const potentialLineChunk = lineChunk + (lineChunk ? ' ' : '') + word;
            if (encoder.encode(potentialLineChunk).length > maxBytes) {
              if (lineChunk) {
                chunks.push(lineChunk);
                lineChunk = word;
              } else {
                const chars = word.split('');
                let charChunk = '';
                for (const char of chars) {
                  const potentialCharChunk = charChunk + char;
                  if (encoder.encode(potentialCharChunk).length > maxBytes) {
                    chunks.push(charChunk);
                    charChunk = char;
                  } else {
                    charChunk = potentialCharChunk;
                  }
                }
                if (charChunk) chunks.push(charChunk);
              }
            } else {
              lineChunk = potentialLineChunk;
            }
          }
          if (lineChunk) chunks.push(lineChunk);
        }
      } else {
        currentChunk = potentialChunk;
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  };

  const translateText = async (text: string, sourceLang: string, targetLang: string): Promise<string> => {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('source_lang', sourceLang);
    formData.append('target_lang', targetLang);

    const response = await fetch('http://45.76.62.31:5001/translate', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Translation error: ${errorText}`);
    }

    const data = await response.json();
    if (!data.translated_text) {
      throw new Error('Invalid translation service response');
    }

    return data.translated_text;
  };

  const translatePDF = async () => {
    if (!instance) return;
    setShowTranslateDialog(false);
    setIsProcessing(true);

    try {
      const { documentViewer, PDFNet } = instance.Core;
      const doc = documentViewer.getDocument();
      
      let extractedText = '';
      const pageCount = doc.getPageCount();
      
      for (let i = 1; i <= pageCount; i++) {
        const text = await doc.loadPageText(i);
        extractedText += text + '\n';
      }

      if (!extractedText.trim()) {
        throw new Error('No text found in the document to translate.');
      }

      const textChunks = splitTextIntoChunks(extractedText);
      let translatedChunks: string[] = [];

      for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];
        const translatedChunk = await translateText(
          chunk,
          translateSourceLang,
          translateTargetLang
        );
        translatedChunks.push(translatedChunk);
      }

      const translatedText = translatedChunks.join('\n');

      await PDFNet.initialize();
      const newDoc = await PDFNet.PDFDoc.create();
      await newDoc.initSecurityHandler();

      const pageWidth = 612;
      const pageHeight = 794;
      const page = await newDoc.pageCreate(await PDFNet.Rect.init(0, 0, pageWidth, pageHeight));

      const builder = await PDFNet.ElementBuilder.create();
      const writer = await PDFNet.ElementWriter.create();
      await writer.beginOnPage(page);
      
      const font = await PDFNet.Font.create(newDoc, PDFNet.Font.StandardType1Font.e_helvetica);
      builder.reset();

      let element = await builder.createTextBegin(font, 12);
      await writer.writeElement(element);

      const lines = translatedText.split('\n');
      let yPos = pageHeight - 70;
      const xPos = 60;
      const lineHeight = 14;

      for (const line of lines) {
        if (yPos < 60) break;
        element = await builder.createTextRun(line, font, 12);
        const textMatrix = await PDFNet.Matrix2D.create(1, 0, 0, 1, xPos, yPos);
        await element.setTextMatrix(textMatrix);
        await writer.writeElement(element);
        yPos -= lineHeight;
      }

      element = await builder.createTextEnd();
      await writer.writeElement(element);
      await writer.end();

      await newDoc.pagePushBack(page);

      const buffer = await newDoc.saveMemoryBuffer(PDFNet.SDFDoc.SaveOptions.e_linearized);
      const pdfFile = new File([new Uint8Array(buffer)], "translated-document.pdf", { type: "application/pdf" });
      instance.UI.loadDocument(pdfFile);

    } catch (error) {
      console.error('Translation error:', error);
      showError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const createNewDocument = async () => {
    if (instance) {
      try {
        const { PDFNet } = instance.Core;
        await PDFNet.initialize();
        const doc = await PDFNet.PDFDoc.create();
        await doc.initSecurityHandler();
        await doc.lock();
        const pageObj = await doc.pageCreate();
        await doc.pagePushBack(pageObj);
        const buffer = await doc.saveMemoryBuffer(PDFNet.SDFDoc.SaveOptions.e_linearized);
        const file = new File([new Uint8Array(buffer)], "new-document.pdf", { type: "application/pdf" });
        instance.UI.loadDocument(file);
        setIsMenuOpen(false);
      } catch (error) {
        console.error("Error creating document:", error);
        showError("Failed to create new document");
      }
    }
  };

  const handleImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setShowLangDialog(true);
    setIsMenuOpen(false);
  };

  const processImage = async () => {
    if (!selectedFile || !instance) return;

    setIsProcessing(true);
    setOcrText('');
    setShowLangDialog(false);

    try {
      if (selectedFile.size > 10 * 1024 * 1024) {
        throw new Error('File size must not exceed 10MB');
      }

      if (!['image/jpeg', 'image/png'].includes(selectedFile.type)) {
        throw new Error('Unsupported file format. Please use JPG or PNG');
      }

      const formData = new FormData();
      formData.append('image', selectedFile);
      formData.append('lang', ocrLang);

      const response = await fetch('http://45.76.62.31:5001/ocr', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        switch (response.status) {
          case 400:
            throw new Error('Invalid image format');
          case 429:
            throw new Error('Daily request limit reached (500 per IP)');
          case 500:
            throw new Error(data.error || 'Error processing image');
          default:
            throw new Error('Error communicating with OCR service');
        }
      }

      const extractedText = data.text || '';
      setOcrText(extractedText);

      const { PDFNet } = instance.Core;
      await PDFNet.initialize();

      const doc = await PDFNet.PDFDoc.create();
      await doc.initSecurityHandler();

      const pageWidth = 612;
      const pageHeight = 794;
      const page = await doc.pageCreate(await PDFNet.Rect.init(0, 0, pageWidth, pageHeight));

      if (extractedText.trim()) {
        const builder = await PDFNet.ElementBuilder.create();
        const writer = await PDFNet.ElementWriter.create();
        await writer.beginOnPage(page);
        
        const font = await PDFNet.Font.create(doc, PDFNet.Font.StandardType1Font.e_helvetica);
        builder.reset();

        let element = await builder.createTextBegin(font, 12);
        await writer.writeElement(element);

        const lines = extractedText.split('\n');
        let yPos = pageHeight - 70;
        const xPos = 60;
        const lineHeight = 14;

        for (const line of lines) {
          if (yPos < 60) break;
          element = await builder.createTextRun(line, font, 12);
          const textMatrix = await PDFNet.Matrix2D.create(1, 0, 0, 1, xPos, yPos);
          await element.setTextMatrix(textMatrix);
          await writer.writeElement(element);
          yPos -= lineHeight;
        }

        element = await builder.createTextEnd();
        await writer.writeElement(element);
        await writer.end();
      }

      await doc.pagePushBack(page);

      const buffer = await doc.saveMemoryBuffer(PDFNet.SDFDoc.SaveOptions.e_linearized);
      const pdfFile = new File([new Uint8Array(buffer)], "ocr-text.pdf", { type: "application/pdf" });
      instance.UI.loadDocument(pdfFile);

    } catch (err) {
      console.error('❌ Error:', err);
      showError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsProcessing(false);
      setSelectedFile(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4"
          >
            <FileText className="w-10 h-10 text-blue-600" />
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 text-transparent bg-clip-text">
              PDF Manager
            </h1>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 relative">
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          >
            <motion.div
              animate={{ 
                scale: [1, 1.2, 1],
                rotate: [0, 360]
              }}
              transition={{ 
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="bg-white p-8 rounded-full shadow-2xl"
            >
              <Loader2 className="w-12 h-12 text-blue-600" />
            </motion.div>
          </motion.div>
        )}

        <AnimatePresence>
          {showErrorDialog && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-red-600">Error</h2>
                  <button
                    onClick={() => setShowErrorDialog(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <p className="text-gray-700 mb-6">{errorMessage}</p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowErrorDialog(false)}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
                >
                  Close
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showLangDialog && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Globe2 className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-semibold">Select Language</h2>
                </div>
                
                <p className="text-gray-600 mb-4">
                  Choose the language of the text to extract from the image
                </p>

                <select
                  value={ocrLang}
                  onChange={(e) => setOcrLang(e.target.value)}
                  className="w-full px-4 py-2 mb-4 border border-gray-200 rounded-xl bg-white shadow-sm hover:border-blue-400 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="eng">English</option>
                  <option value="fra">French</option>
                  <option value="deu">German</option>
                  <option value="ita">Italian</option>
                  <option value="spa">Spanish</option>
                </select>

                <div className="flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setShowLangDialog(false);
                      setSelectedFile(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={processImage}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:shadow-lg transition-all duration-200"
                  >
                    Continue
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showTranslateDialog && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4"
              >
                <div className="flex items-center gap-3 mb-4">
                  <Languages className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-semibold">Translate</h2>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Source Language
                    </label>
                    <select
                      value={translateSourceLang}
                      onChange={(e) => setTranslateSourceLang(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white shadow-sm hover:border-blue-400 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="es">Spanish</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Target Language
                    </label>
                    <select
                      value={translateTargetLang}
                      onChange={(e) => setTranslateTargetLang(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white shadow-sm hover:border-blue-400 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="es">Spanish</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowTranslateDialog(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={translatePDF}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:shadow-lg transition-all duration-200"
                  >
                    Translate
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full h-[calc(100vh-8rem)] border border-gray-200 rounded-xl shadow-lg overflow-hidden"
          ref={viewer}
        />

        <motion.div 
          className="fixed bottom-8 right-8 z-40"
          initial={false}
        >
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute bottom-16 right-0 bg-white rounded-2xl shadow-xl p-4 space-y-3 min-w-[200px]"
              >
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={createNewDocument}
                  className="flex items-center gap-2 w-full px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl hover:shadow-lg transition-all duration-200"
                >
                  <FilePlus className="w-5 h-5" />
                  New
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowTranslateDialog(true)}
                  className="flex items-center gap-2 w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:shadow-lg transition-all duration-200"
                >
                  <Languages className="w-5 h-5" />
                  Translate
                </motion.button>

                <input
                  type="file"
                  ref={imageInputRef}
                  onChange={handleImageSelected}
                  accept=".jpg,.jpeg,.png"
                  className="hidden"
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isProcessing}
                  className={`flex items-center gap-2 w-full px-4 py-2 rounded-xl transition-all duration-200 ${
                    isProcessing 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:shadow-lg text-white'
                  }`}
                >
                  {isProcessing ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Loader2 className="w-5 h-5" />
                    </motion.div>
                  ) : (
                    <Image className="w-5 h-5" />
                  )}
                  {isProcessing ? 'Processing...' : 'OCR'}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-colors"
          >
            {isMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}

export default App;