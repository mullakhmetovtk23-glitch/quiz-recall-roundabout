CREATE POLICY "card-images read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'card-images');
CREATE POLICY "card-images insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'card-images');
CREATE POLICY "card-images update" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'card-images') WITH CHECK (bucket_id = 'card-images');
CREATE POLICY "card-images delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'card-images');